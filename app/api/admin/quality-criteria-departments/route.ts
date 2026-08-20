import { NextRequest, NextResponse } from "next/server";
import {
  QUALITY_CRITERIA_DEPARTMENTS,
  qualityCriteriaDepartmentsListResponseSchema,
  upsertQualityCriterionDepartmentsRequestSchema,
} from "../../../../src/contracts/quality-criteria-departments";
import { authFromNextRequest } from "../../../../src/server/auth/request-auth";
import {
  listQualityCriterionCandidates,
  listQualityCriterionDepartmentMappings,
  mergeCandidatesWithMappings,
  upsertQualityCriterionDepartments,
} from "../../../../src/server/quality-criteria/service";

export async function GET(request: NextRequest) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const lite = ["1", "true", "yes"].includes(
    String(request.nextUrl.searchParams.get("lite") || "").toLowerCase(),
  );

  try {
    const mappings = await listQualityCriterionDepartmentMappings();
    if (lite) {
      const body = qualityCriteriaDepartmentsListResponseSchema.parse({
        departments: [...QUALITY_CRITERIA_DEPARTMENTS],
        candidates: mergeCandidatesWithMappings([], mappings),
        mappings,
        candidatesError: null,
      });
      return NextResponse.json(body, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }

    let candidates = [];
    let candidatesError: string | null = null;
    try {
      candidates = await listQualityCriterionCandidates();
    } catch (cause) {
      console.error("[admin/quality-criteria-departments] candidates", cause);
      candidatesError =
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar subcritérios no Databricks.";
    }

    const body = qualityCriteriaDepartmentsListResponseSchema.parse({
      departments: [...QUALITY_CRITERIA_DEPARTMENTS],
      candidates: mergeCandidatesWithMappings(candidates, mappings),
      mappings,
      candidatesError,
    });
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Não foi possível carregar critérios × departamentos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const parsed = upsertQualityCriterionDepartmentsRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const mapping = await upsertQualityCriterionDepartments(parsed.data);
    return NextResponse.json({ mapping }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Não foi possível salvar o mapeamento.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
