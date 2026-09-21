import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import {
  cleanupStaleAnalysisAttachments,
  deleteAnalysisAttachments,
} from "../../../../../lib/auditor/analysis-attachments";
import {
  ANALYSIS_ATTACHMENT_CONTENT_TYPES,
  analysisAttachmentPathname,
  analysisAttachmentSchema,
  analysisAttachmentUploadSchema,
  MAX_ANALYSIS_ATTACHMENT_BYTES,
} from "../../../../../lib/auditor/types";
import { authFromNextRequest } from "../../../../../src/server/auth/request-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });

  const auth = body.type === "blob.generate-client-token"
    ? authFromNextRequest(request)
    : null;
  if (body.type === "blob.generate-client-token" && !auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!auth?.isAdmin) throw new Error("Acesso não autorizado.");
        const metadata = analysisAttachmentUploadSchema.parse(JSON.parse(clientPayload || "{}"));
        const expected = analysisAttachmentPathname(metadata.id, metadata.originalName);
        if (pathname !== expected) throw new Error("Caminho de anexo inválido.");
        if (metadata.size > MAX_ANALYSIS_ATTACHMENT_BYTES) {
          throw new Error("Cada anexo deve ter no máximo 12 MB.");
        }

        await cleanupStaleAnalysisAttachments().catch((cause) => {
          console.error("[auditor-attachments] stale cleanup failure", cause);
        });

        return {
          allowedContentTypes: [...ANALYSIS_ATTACHMENT_CONTENT_TYPES],
          maximumSizeInBytes: MAX_ANALYSIS_ATTACHMENT_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
        };
      },
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Falha ao autorizar o anexo.";
    console.error("[auditor-attachments] upload failure", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }
  const parsed = analysisAttachmentSchema.array().max(8).safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Referências de anexos inválidas." }, { status: 400 });
  }
  await deleteAnalysisAttachments(parsed.data);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
