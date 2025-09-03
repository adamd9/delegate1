import ThoughtflowD2Viewer from "@/components/ThoughtflowD2Viewer";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ThoughtflowViewerPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <div className="h-screen">
      <ThoughtflowD2Viewer id={id} />
    </div>
  );
}
