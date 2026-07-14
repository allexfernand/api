type DashboardFragmentProps = {
  html: string;
  className?: string;
};

export function DashboardFragment({ html, className = "dashboard-fragment" }: DashboardFragmentProps) {
  return (
    <div className={className} style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
