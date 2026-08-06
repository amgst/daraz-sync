import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api, type Product, type DarazExistingProduct } from "../api";
import { useToast } from "../ToastContext";
import CategoryPicker from "./CategoryPicker";

interface VariantRow {
  sku: string;
  price: string;
  compareAtPrice: string;
  quantity: string;
  packageWeightKg: string;
  packageLengthCm: string;
  packageWidthCm: string;
  packageHeightCm: string;
}

const emptyVariant = (): VariantRow => ({
  sku: "",
  price: "",
  compareAtPrice: "",
  quantity: "0",
  packageWeightKg: "",
  packageLengthCm: "",
  packageWidthCm: "",
  packageHeightCm: "",
});

// Daraz's per-SKU package dimension fields - keyed by the raw attribute name
// the category schema (and sync payload) uses, so the "required" flags this
// app fetches from Daraz can drive the UI without a separate mapping table.
const DIMENSION_COLUMNS: Array<{ field: string; key: keyof VariantRow; label: string }> = [
  { field: "package_weight", key: "packageWeightKg", label: "Weight (kg)" },
  { field: "package_length", key: "packageLengthCm", label: "Length (cm)" },
  { field: "package_width", key: "packageWidthCm", label: "Width (cm)" },
  { field: "package_height", key: "packageHeightCm", label: "Height (cm)" },
];

export default function ProductForm() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();

  const [loaded, setLoaded] = useState(isNew);
  const [title, setTitle] = useState("");
  const [descriptionHtml, setDescriptionHtml] = useState("");
  const [vendor, setVendor] = useState("");
  const [imagesText, setImagesText] = useState("");
  const [variants, setVariants] = useState<VariantRow[]>([emptyVariant()]);
  const [savingBasic, setSavingBasic] = useState(false);
  const [basicError, setBasicError] = useState<string | null>(null);

  const [product, setProduct] = useState<Product | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [attrPairs, setAttrPairs] = useState<Array<{ key: string; value: string; mandatory?: boolean }>>([]);
  const [requiredSkuFields, setRequiredSkuFields] = useState<string[]>([]);
  const [busyMapping, setBusyMapping] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);

  const [linkQuery, setLinkQuery] = useState("");
  const [linkResults, setLinkResults] = useState<DarazExistingProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) return;
    api.get<{ product: Product }>(`/products/${id}`).then((r) => {
      const p = r.product;
      setProduct(p);
      setTitle(p.title);
      setDescriptionHtml(p.descriptionHtml ?? "");
      setVendor(p.vendor ?? "");
      setImagesText((JSON.parse(p.imagesJson) as string[]).join("\n"));
      setVariants(
        p.variants.length
          ? p.variants.map((v) => ({
              sku: v.sku,
              price: v.price,
              compareAtPrice: v.compareAtPrice ?? "",
              quantity: String(v.quantity),
              packageWeightKg: v.packageWeightKg != null ? String(v.packageWeightKg) : "",
              packageLengthCm: v.packageLengthCm != null ? String(v.packageLengthCm) : "",
              packageWidthCm: v.packageWidthCm != null ? String(v.packageWidthCm) : "",
              packageHeightCm: v.packageHeightCm != null ? String(v.packageHeightCm) : "",
            }))
          : [emptyVariant()],
      );
      setCategoryId(p.darazCategoryId ?? "");
      setAttrPairs(
        p.attributesJson ? Object.entries(JSON.parse(p.attributesJson) as Record<string, string>).map(([key, value]) => ({ key, value })) : [],
      );
      setLoaded(true);
    });
  }, [id, isNew]);

  const updateVariant = (index: number, field: keyof VariantRow, value: string) =>
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)));
  const addVariant = () => setVariants((prev) => [...prev, emptyVariant()]);
  const removeVariant = (index: number) => setVariants((prev) => prev.filter((_, i) => i !== index));

  const buildBasicPayload = () => ({
    title,
    descriptionHtml,
    vendor,
    images: imagesText.split("\n").map((s) => s.trim()).filter(Boolean),
    variants: variants
      .filter((v) => v.sku.trim() && v.price.trim())
      .map((v) => ({
        sku: v.sku.trim(),
        price: v.price.trim(),
        compareAtPrice: v.compareAtPrice.trim() || undefined,
        quantity: Number(v.quantity) || 0,
        packageWeightKg: v.packageWeightKg.trim() ? Number(v.packageWeightKg) : undefined,
        packageLengthCm: v.packageLengthCm.trim() ? Number(v.packageLengthCm) : undefined,
        packageWidthCm: v.packageWidthCm.trim() ? Number(v.packageWidthCm) : undefined,
        packageHeightCm: v.packageHeightCm.trim() ? Number(v.packageHeightCm) : undefined,
      })),
  });

  const saveBasic = async () => {
    setSavingBasic(true);
    setBasicError(null);
    const payload = buildBasicPayload();
    try {
      if (isNew) {
        const res = await api.post<{ product: Product }>("/products", payload);
        toast.show("Product created");
        navigate(`/products/${res.product.id}`);
      } else {
        await api.put(`/products/${id}`, payload);
        toast.show("Product saved");
      }
    } catch (err) {
      setBasicError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingBasic(false);
    }
  };

  const addAttrRow = () => setAttrPairs((prev) => [...prev, { key: "", value: "" }]);
  const removeAttrRow = (i: number) => setAttrPairs((prev) => prev.filter((_, idx) => idx !== i));
  const updateAttrRow = (i: number, field: "key" | "value", value: string) =>
    setAttrPairs((prev) => prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));

  const loadSuggestedAttributes = async () => {
    if (!id) return;
    const res = await api.get<{
      suggestions: Array<{ name: string; label: string; mandatory: boolean }>;
      requiredSkuFields: string[];
    }>(`/products/${id}/suggested-attributes?categoryId=${encodeURIComponent(categoryId)}`);
    setRequiredSkuFields(res.requiredSkuFields);
    // Several categories require English-mirror fields (name_en/description_en)
    // alongside the base Title/Description this app already collects - default
    // them from those instead of making the user retype the same text.
    const englishMirrorDefaults: Record<string, string> = {
      name_en: title,
      description_en: descriptionHtml,
    };
    const existingKeys = new Set(attrPairs.map((p) => p.key));
    const newPairs = res.suggestions
      .filter((a) => !existingKeys.has(a.name))
      .map((a) => ({ key: a.name, value: englishMirrorDefaults[a.name] ?? "", mandatory: a.mandatory }));
    if (newPairs.length === 0) {
      toast.show("No attribute suggestions available - add manually");
    } else {
      setAttrPairs((prev) => [...prev, ...newPairs]);
      const mandatoryCount = newPairs.filter((p) => p.mandatory).length;
      if (mandatoryCount > 0) {
        toast.show(`${mandatoryCount} of the added attributes are required by Daraz for this category`);
      }
    }
  };

  const missingMandatoryFields = () => {
    const missingAttrs = attrPairs.filter((p) => p.mandatory && p.key.trim() && !p.value.trim()).map((p) => p.key);
    const missingDimensions = DIMENSION_COLUMNS.filter(
      (col) =>
        requiredSkuFields.includes(col.field) && variants.some((v) => v.sku.trim() && !v[col.key].trim()),
    ).map((col) => col.label);
    return { missingAttrs, missingDimensions };
  };

  const saveMapping = async (andSync: boolean) => {
    if (!id) return;
    setMappingError(null);
    if (andSync) {
      const { missingAttrs, missingDimensions } = missingMandatoryFields();
      if (missingAttrs.length > 0 || missingDimensions.length > 0) {
        const parts = [...missingAttrs, ...missingDimensions];
        setMappingError(`Daraz requires a value for: ${parts.join(", ")}`);
        return;
      }
    }
    setBusyMapping(true);
    try {
      // Basic info (title/variants/weight) lives on a separate "Save product"
      // button in the UI - persist it here too so a sync always reflects
      // what's on screen, not whatever was last explicitly saved.
      await api.put(`/products/${id}`, buildBasicPayload());
      const attributes = Object.fromEntries(attrPairs.filter((p) => p.key.trim()).map((p) => [p.key, p.value]));
      await api.put(`/products/${id}/mapping`, { categoryId, attributes });
      if (andSync) {
        await api.post(`/products/${id}/sync`);
        toast.show("Synced to Daraz");
      } else {
        toast.show("Mapping saved");
      }
      const res = await api.get<{ product: Product }>(`/products/${id}`);
      setProduct(res.product);
    } catch (err) {
      setMappingError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusyMapping(false);
    }
  };

  const searchDaraz = async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const res = await api.get<{ results: DarazExistingProduct[] }>(
        `/products/search/daraz?q=${encodeURIComponent(linkQuery)}`,
      );
      setLinkResults(res.results);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const linkProduct = async (darazItem: DarazExistingProduct) => {
    if (!id) return;
    setLinking(darazItem.item_id);
    try {
      await api.post(`/products/${id}/link`, {
        darazItemId: darazItem.item_id,
        darazCategoryId: darazItem.primary_category,
        darazSkuId: darazItem.skus[0]?.SkuId,
      });
      toast.show("Linked to existing Daraz product");
      const res = await api.get<{ product: Product }>(`/products/${id}`);
      setProduct(res.product);
      setCategoryId(res.product.darazCategoryId ?? "");
    } finally {
      setLinking(null);
    }
  };

  if (!loaded) return null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{isNew ? "New product" : `Edit: ${title || "Product"}`}</h1>
          {product?.darazItemId && <p className="subtitle">Currently linked to Daraz item {product.darazItemId}.</p>}
        </div>
        <Link to="/products">
          <button>Back to products</button>
        </Link>
      </div>

      <div className="card">
        <h2>Basic info</h2>
        <div className="stack">
          <div className="field">
            <label>Title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea value={descriptionHtml} onChange={(e) => setDescriptionHtml(e.target.value)} />
          </div>
          <div className="field">
            <label>Brand / vendor</label>
            <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>
          <div className="field">
            <label>Image URLs (one per line)</label>
            <textarea value={imagesText} onChange={(e) => setImagesText(e.target.value)} />
          </div>

          <div className="field">
            <label>Variants</label>
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Price</th>
                  <th>Compare-at</th>
                  <th>Quantity</th>
                  {DIMENSION_COLUMNS.map((col) => (
                    <th key={col.field}>
                      {col.label}
                      {requiredSkuFields.includes(col.field) && <span className="required-mark"> *required</span>}
                    </th>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v, i) => (
                  <tr key={i}>
                    <td>
                      <input type="text" value={v.sku} onChange={(e) => updateVariant(i, "sku", e.target.value)} />
                    </td>
                    <td>
                      <input type="text" value={v.price} onChange={(e) => updateVariant(i, "price", e.target.value)} />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={v.compareAtPrice}
                        onChange={(e) => updateVariant(i, "compareAtPrice", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={v.quantity}
                        onChange={(e) => updateVariant(i, "quantity", e.target.value)}
                      />
                    </td>
                    {DIMENSION_COLUMNS.map((col) => (
                      <td key={col.field}>
                        <input
                          type="number"
                          step="0.01"
                          value={v[col.key]}
                          onChange={(e) => updateVariant(i, col.key, e.target.value)}
                          className={
                            requiredSkuFields.includes(col.field) && v.sku.trim() && !v[col.key].trim()
                              ? "field-missing"
                              : ""
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <button className="plain critical" onClick={() => removeVariant(i)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button style={{ marginTop: 8 }} onClick={addVariant}>
              Add variant
            </button>
          </div>

          <div className="row">
            <button className="primary" onClick={saveBasic} disabled={savingBasic}>
              {savingBasic ? "Saving..." : isNew ? "Create product" : "Save product"}
            </button>
          </div>
          {basicError && <p className="error-text">{basicError}</p>}
        </div>
      </div>

      {!isNew && (
        <>
          <div className="card">
            <h2>Link an existing Daraz product</h2>
            <p className="subdued small">
              Already have this product listed on Daraz? Search by SKU or title and link it here
              instead of creating a duplicate.
            </p>
            <div className="row end">
              <div className="field" style={{ minWidth: 260 }}>
                <input
                  type="text"
                  placeholder="SKU or title"
                  value={linkQuery}
                  onChange={(e) => setLinkQuery(e.target.value)}
                />
              </div>
              <button onClick={searchDaraz} disabled={!linkQuery || searching}>
                {searching ? "Searching..." : "Search Daraz"}
              </button>
            </div>
            {searchError && <p className="error-text">{searchError}</p>}
            {linkResults.map((r) => (
              <div className="list-item" key={r.item_id}>
                <div className="grow">
                  <div className="title">{r.attributes?.name ?? `Item ${r.item_id}`}</div>
                  <div className="meta">
                    Item {r.item_id} - {r.skus.length} SKU(s)
                  </div>
                </div>
                <button onClick={() => linkProduct(r)} disabled={linking === r.item_id}>
                  {linking === r.item_id ? "Linking..." : "Link this product"}
                </button>
              </div>
            ))}
          </div>

          <div className="card">
            <h2>Daraz category</h2>
            <CategoryPicker categoryId={categoryId} onChange={setCategoryId} />
            <div className="row" style={{ marginTop: 10 }}>
              <button onClick={loadSuggestedAttributes} disabled={!categoryId}>
                Load suggested attributes
              </button>
            </div>

            <div className="divider" />

            <h2>Attributes</h2>
            <div className="stack gap-4">
              {attrPairs.map((p, i) => (
                <div className="row" key={i}>
                  <input
                    type="text"
                    placeholder="Attribute name"
                    value={p.key}
                    onChange={(e) => updateAttrRow(i, "key", e.target.value)}
                    style={{ maxWidth: 220 }}
                  />
                  <input
                    type="text"
                    placeholder="Value"
                    value={p.value}
                    onChange={(e) => updateAttrRow(i, "value", e.target.value)}
                    style={{ maxWidth: 260 }}
                    className={p.mandatory && !p.value.trim() ? "field-missing" : ""}
                  />
                  {p.mandatory && <span className="required-mark">*required</span>}
                  <button className="plain critical" onClick={() => removeAttrRow(i)}>
                    Remove
                  </button>
                </div>
              ))}
              <div>
                <button onClick={addAttrRow}>Add attribute</button>
              </div>
            </div>

            <div className="divider" />

            <div className="row">
              <button onClick={() => saveMapping(false)} disabled={busyMapping}>
                Save mapping
              </button>
              <button className="primary" onClick={() => saveMapping(true)} disabled={busyMapping}>
                Save & sync now
              </button>
            </div>
            {(mappingError ?? product?.lastError) && <p className="error-text">{mappingError ?? product?.lastError}</p>}
          </div>
        </>
      )}
    </>
  );
}
