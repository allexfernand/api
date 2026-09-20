import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import {
  documentPathname,
  MAX_DOCUMENT_BYTES,
  registerUploadedDocument,
} from "../../../../../lib/auditor/document-store";
import { uploadMetadataSchema } from "../../../../../lib/auditor/document-types";
import { authFromNextRequest } from "../../../../../src/server/auth/request-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });

  const requestAuth = body.type === "blob.generate-client-token"
    ? authFromNextRequest(request)
    : null;
  if (body.type === "blob.generate-client-token" && !requestAuth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!requestAuth?.isAdmin) throw new Error("Acesso não autorizado.");
        const payload = uploadMetadataSchema
          .omit({ uploadedBy: true })
          .parse(JSON.parse(clientPayload || "{}"));
        const metadata = { ...payload, uploadedBy: requestAuth.user };
        const expected = documentPathname(metadata.category, metadata.id, metadata.originalName);
        if (pathname !== expected) throw new Error("Caminho de upload inválido.");

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_DOCUMENT_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
          tokenPayload: JSON.stringify(metadata),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const metadata = uploadMetadataSchema.parse(JSON.parse(tokenPayload || "{}"));
        await registerUploadedDocument(metadata, blob.pathname);
      },
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Falha ao autorizar o upload.";
    console.error("[auditor-documents] upload failure", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
