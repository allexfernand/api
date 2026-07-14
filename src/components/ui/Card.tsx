import type { ComponentPropsWithoutRef, ReactNode } from "react";

type CardProps = ComponentPropsWithoutRef<"section"> & { title?: ReactNode };

export function Card({ title, children, className = "", ...props }: CardProps) {
  return (
    <section className={`card-box ${className}`.trim()} {...props}>
      {title ? <div className="section-title">{title}</div> : null}
      {children}
    </section>
  );
}
