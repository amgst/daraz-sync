type Props = {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
};

export default function Pagination({ page, totalPages, onChange }: Props) {
  if (totalPages <= 1) return null;
  return (
    <div className="row pagination">
      <button onClick={() => onChange(page - 1)} disabled={page <= 1}>
        Previous
      </button>
      <span className="subdued small">
        Page {page} of {totalPages}
      </span>
      <button onClick={() => onChange(page + 1)} disabled={page >= totalPages}>
        Next
      </button>
    </div>
  );
}
