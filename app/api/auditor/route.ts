import { NextRequest, NextResponse } from "next/server";
import {
  deleteAnalysisAttachments,
  loadAnalysisAttachments,
} from "../../../lib/auditor/analysis-attachments";
import { callAuditor, AuditorServiceError } from "../../../lib/auditor/glm-client";
import { auditorRequestSchema } from "../../../lib/auditor/types";
import { authFromNextRequest } from "../../../src/server/auth/request-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const parsed = auditorRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Mensagem inválida.", details: parsed.error.flatten() },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  let attachmentsLoaded = parsed.data.attachments.length === 0;
  try {
    const analysisDocuments = await loadAnalysisAttachments(parsed.data.attachments);
    attachmentsLoaded = true;
    const result = await callAuditor(parsed.data, analysisDocuments);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (cause) {
    if (cause instanceof AuditorServiceError) {
      return NextResponse.json(
        { error: cause.publicMessage },
        { status: cause.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!attachmentsLoaded && cause instanceof Error) {
      return NextResponse.json(
        { error: cause.message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("[auditor] unexpected failure", cause);
    return NextResponse.json(
      { error: "Não foi possível concluir a análise." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    await deleteAnalysisAttachments(parsed.data.attachments).catch((cause) => {
      console.error("[auditor-attachments] post-analysis cleanup failure", cause);
    });
  }
}
