export default function FolderGroup({ data }) {
  return (
    <div className="folder-group-node" title={data.label}>
      {data.label}
    </div>
  );
}
