"use client";

import { ErrorState } from "../src/components/ui/AsyncState";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorState message={error.message || "Não foi possível carregar o dashboard."} retry={reset} />;
}
