import ThoughtflowD2Viewer from "@/components/ThoughtflowD2Viewer";

export default function ThoughtflowViewerPage({ params }: { params: { id: string } }) {
  const { id } = params;
  return (
    <div className="h-screen">
      <ThoughtflowD2Viewer id={id} />
    </div>
  );
}
