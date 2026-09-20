import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  activateDocumentVersion,
  archiveDocumentVersion,
} from "../../../../../lib/auditor/document-store";
import { documentActionSchema } from "../../../../../lib/auditor/document-types";
import { authFromNextRequest } from "../../../../../src/server/auth/request-auth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const { id: rawId } = await params;
  const id = z.string().uuid().safeParse(rawId);
  const action = documentActionSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !action.success) {
    return NextResponse.json({ error: "Ação ou versão inválida." }, { status: 400 });
  }

  try {
    const document = action.data.action === "activate"
      ? await activateDocumentVersion(id.data, auth.user)
      : await archiveDocumentVersion(id.data, auth.user);
    return NextResponse.json(
      { document },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Não foi possível atualizar a versão.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
