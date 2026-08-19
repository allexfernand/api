import { NextRequest, NextResponse } from "next/server";
import {
  ATTENDANT_DEPARTMENTS,
  attendantsListResponseSchema,
  upsertAttendantMappingRequestSchema,
} from "../../../../src/contracts/attendants";
import { authFromNextRequest } from "../../../../src/server/auth/request-auth";
import {
  listAttendantMappings,
  listFinishedByCandidates,
  mergeCandidatesWithMappings,
  upsertAttendantMapping,
} from "../../../../src/server/attendants/service";

export async function GET(request: NextRequest) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const lite = ["1", "true", "yes"].includes(
    String(request.nextUrl.searchParams.get("lite") || "").toLowerCase(),
  );
  const months = Number(request.nextUrl.searchParams.get("months") || 12);

  try {
    // Mapeamentos no Edge Config são rápidos — devolve logo no modo lite.
    const mappings = await listAttendantMappings();
    if (lite) {
      const body = attendantsListResponseSchema.parse({
        departments: [...ATTENDANT_DEPARTMENTS],
        candidates: mergeCandidatesWithMappings([], mappings),
        mappings,
        candidatesError: null,
        candidatesMonths: months,
      });
      return NextResponse.json(body, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }

    let candidates = [];
    let candidatesError: string | null = null;
    try {
      candidates = await listFinishedByCandidates(months);
    } catch (cause) {
      console.error("[admin/attendants] candidates", cause);
      candidatesError =
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar finished_by no Databricks.";
    }

    const body = attendantsListResponseSchema.parse({
      departments: [...ATTENDANT_DEPARTMENTS],
      candidates: mergeCandidatesWithMappings(candidates, mappings),
      mappings,
      candidatesError,
      candidatesMonths: months,
    });
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Não foi possível carregar atendentes.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const parsed = upsertAttendantMappingRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const mapping = await upsertAttendantMapping(parsed.data);
    return NextResponse.json({ mapping }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Não foi possível salvar o atendente.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
