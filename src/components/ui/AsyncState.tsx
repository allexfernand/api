import type { ReactNode } from "react";

export function LoadingState({ children = "Carregando..." }: { children?: ReactNode }) {
  return <div className="loading-box">{children}</div>;
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="loading-box" role="alert">
      <div>{message}</div>
      {retry ? <button onClick={retry}>Tentar novamente</button> : null}
    </div>
  );
}

export function EmptyState({ children = "Nenhum dado encontrado." }: { children?: ReactNode }) {
  return <div className="loading-box">{children}</div>;
}
