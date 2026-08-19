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
  upsertAttendantMapping,
} from "../../../../src/server/attendants/service";

export async function GET(request: NextRequest) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  try {
    const [candidates, mappings] = await Promise.all([
      listFinishedByCandidates().catch((cause) => {
        console.error("[admin/attendants] candidates", cause);
        return [];
      }),
      listAttendantMappings(),
    ]);

    const body = attendantsListResponseSchema.parse({
      departments: [...ATTENDANT_DEPARTMENTS],
      candidates,
      mappings,
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
