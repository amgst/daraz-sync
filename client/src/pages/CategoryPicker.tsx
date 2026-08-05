import { useState } from "react";
import { api, type DarazCategoryNode } from "../api";

function findPath(tree: DarazCategoryNode[], targetId: string): DarazCategoryNode[] | null {
  for (const node of tree) {
    if (node.id === targetId) return [node];
    const childPath = findPath(node.children, targetId);
    if (childPath) return [node, ...childPath];
  }
  return null;
}

export default function CategoryPicker({
  categoryId,
  onChange,
}: {
  categoryId: string;
  onChange: (id: string) => void;
}) {
  const [tree, setTree] = useState<DarazCategoryNode[]>([]);
  const [path, setPath] = useState<DarazCategoryNode[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ categoryTree: DarazCategoryNode[] }>("/daraz/categories");
      setTree(res.categoryTree);
      setPath(findPath(res.categoryTree, categoryId) ?? []);
    } finally {
      setLoading(false);
    }
  };

  const selectAtLevel = (level: number, id: string) => {
    const options = level === 0 ? tree : path[level - 1].children;
    const node = options.find((n) => n.id === id);
    if (!node) return;
    const newPath = [...path.slice(0, level), node];
    setPath(newPath);
    onChange(node.isLeaf ? node.id : "");
  };

  return (
    <div className="stack">
      {tree.length === 0 ? (
        <div className="row">
          <button onClick={load} disabled={loading}>
            {loading ? "Loading..." : "Load Daraz categories"}
          </button>
          <span className="subdued small">Fetches Daraz's category list - can take a few seconds.</span>
        </div>
      ) : (
        <div className="stack gap-4">
          {[tree, ...path.map((n) => n.children)]
            .filter((level) => level.length > 0)
            .map((levelOptions, level) => (
              <div className="field" key={level} style={{ maxWidth: 320 }}>
                <select value={path[level]?.id ?? ""} onChange={(e) => selectAtLevel(level, e.target.value)}>
                  <option value="">Select...</option>
                  {levelOptions.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
        </div>
      )}
      <div className="field" style={{ maxWidth: 260 }}>
        <label>Category ID (manual override)</label>
        <input
          type="text"
          placeholder="e.g. 12345"
          value={categoryId}
          onChange={(e) => {
            onChange(e.target.value);
            setPath([]);
          }}
        />
      </div>
    </div>
  );
}
