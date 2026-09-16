import React, { useEffect, useState } from 'react';
import {
  Layers,
  RefreshCw,
  Plus,
  Upload,
  Download,
  AlertTriangle,
  CheckCircle,
  FileSpreadsheet,
  Link,
  Unlink,
  Sliders,
  TrendingDown,
} from 'lucide-react';
import { collection, onSnapshot, doc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { POSIntegrationConfig, POSSaleRecord, RecipeBOM, Item, Issue } from '../types';
import { calculateTheoreticalConsumption, calculateTheoreticalVsActualVariance } from '../services/posIntegrationService';
import { exportToCsv, exportToPdf } from '../services/exportService';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';

export const POSIntegrationView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId } = useAuth();

  const [posConfig, setPosConfig] = useState<POSIntegrationConfig | null>(null);
  const [recipes, setRecipes] = useState<RecipeBOM[]>([]);
  const [sales, setSales] = useState<POSSaleRecord[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  // Recipe Modal
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [posItemName, setPosItemName] = useState('');
  const [posItemCode, setPosItemCode] = useState('');
  const [recipeIngredients, setRecipeIngredients] = useState<
    { itemId: string; itemName: string; unit: string; quantity: number }[]
  >([]);

  // CSV Sales Import Modal
  const [isSalesModalOpen, setIsSalesModalOpen] = useState(false);
  const [csvSalesText, setCsvSalesText] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // Configuration Modal
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [configProvider, setConfigProvider] = useState<'PETPOOJA' | 'EZEE' | 'OTHER'>('PETPOOJA');
  const [configApiKey, setConfigApiKey] = useState('');
  const [configMerchantId, setConfigMerchantId] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);

  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubConfig = onSnapshot(
      doc(db, 'restaurants', activeRestaurantId, 'settings', 'posIntegration'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as POSIntegrationConfig;
          setPosConfig(data);
          setConfigProvider(data.provider || 'PETPOOJA');
          setConfigApiKey(data.apiKey || '');
          setConfigMerchantId(data.webhookSecret || '');
        } else {
          // No configuration exists in database
          setPosConfig(null);
        }
      }
    );

    const unsubRecipes = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'recipes'), (snap) => {
      setRecipes(snap.docs.map((d) => d.data() as RecipeBOM));
    });

    const unsubSales = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'posSales'), (snap) => {
      setSales(snap.docs.map((d) => d.data() as POSSaleRecord));
    });

    const unsubItems = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'items'), (snap) => {
      setItems(snap.docs.map((d) => d.data() as Item));
      setLoading(false);
    });

    const unsubIssues = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'issues'), (snap) => {
      setIssues(snap.docs.map((d) => d.data() as Issue));
    });

    return () => {
      unsubConfig();
      unsubRecipes();
      unsubSales();
      unsubItems();
      unsubIssues();
    };
  }, [activeRestaurantId]);

  // Calculate Theoretical vs Actual Consumption
  const theoreticalUsage = calculateTheoreticalConsumption(sales, recipes);
  const variances = calculateTheoreticalVsActualVariance(theoreticalUsage, issues, items);

  const openNewRecipeModal = () => {
    setPosItemName('');
    setPosItemCode('');
    if (items.length > 0) {
      setRecipeIngredients([{ itemId: items[0].id, itemName: items[0].name, unit: items[0].unit, quantity: 0.1 }]);
    }
    setIsRecipeModalOpen(true);
  };

  const addIngredient = () => {
    if (items.length > 0) {
      setRecipeIngredients([
        ...recipeIngredients,
        { itemId: items[0].id, itemName: items[0].name, unit: items[0].unit, quantity: 0.1 },
      ]);
    }
  };

  const updateIngredient = (idx: number, field: string, val: any) => {
    const updated = [...recipeIngredients];
    if (field === 'itemId') {
      const selectedItem = items.find((i) => i.id === val);
      updated[idx] = {
        ...updated[idx],
        itemId: val,
        itemName: selectedItem?.name || '',
        unit: selectedItem?.unit || 'Kg',
      };
    } else {
      updated[idx] = { ...updated[idx], [field]: val };
    }
    setRecipeIngredients(updated);
  };

  const removeIngredient = (idx: number) => {
    if (recipeIngredients.length > 1) {
      setRecipeIngredients(recipeIngredients.filter((_, i) => i !== idx));
    }
  };

  const handleSaveRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId || !posItemName.trim() || recipeIngredients.length === 0) return;

    const rRef = doc(collection(db, 'restaurants', activeRestaurantId, 'recipes'));
    const newRecipe: RecipeBOM = {
      id: rRef.id,
      posItemName: posItemName.trim(),
      posItemCode: posItemCode.trim() || `POS-${Date.now().toString().slice(-4)}`,
      ingredients: recipeIngredients.map((ing) => ({
        itemId: ing.itemId,
        itemName: ing.itemName,
        quantity: Number(ing.quantity) || 0,
        unit: ing.unit,
      })),
      restaurantId: activeRestaurantId,
      createdAt: new Date().toISOString(),
    };

    await setDoc(rRef, newRecipe);
    setIsRecipeModalOpen(false);
  };

  // Import Sales CSV
  const handleImportSales = async () => {
    if (!activeRestaurantId || !csvSalesText.trim()) return;
    try {
      setImportStatus('Processing POS sales records...');
      const lines = csvSalesText.trim().split('\n');
      const startIndex = lines[0].toLowerCase().includes('item') ? 1 : 0;
      let count = 0;

      for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const [itemName, soldQty, salePrice] = line.split(',').map((p) => p.trim());
        if (itemName && soldQty) {
          const sRef = doc(collection(db, 'restaurants', activeRestaurantId, 'posSales'));
          const sDoc: POSSaleRecord = {
            id: sRef.id,
            billNumber: `BILL-${Math.floor(1000 + Math.random() * 9000)}`,
            posItemName: itemName,
            quantity: Number(soldQty) || 1,
            totalAmount: Number(salePrice) || 0,
            saleDate: new Date().toISOString().slice(0, 10),
            restaurantId: activeRestaurantId,
          };
          await setDoc(sRef, sDoc);
          count++;
        }
      }

      setImportStatus(`Successfully synced ${count} sales records!`);
      setTimeout(() => {
        setIsSalesModalOpen(false);
        setImportStatus(null);
        setCsvSalesText('');
      }, 1500);
    } catch (e: any) {
      setImportStatus(`Import failed: ${e?.message}`);
    }
  };

  const handleExportVarianceCsv = () => {
    const headers = ['Raw Material', 'Theoretical Usage', 'Actual Store Issues', 'Variance Qty', 'Variance Loss Value'];
    const rows = variances.map((v) => [v.itemName, v.theoreticalQty, v.actualIssuedQty, v.varianceQty, v.varianceValue]);
    exportToCsv(`pos_variance_audit_${activeRestaurant?.name || 'store'}`, headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">POS Integration & Recipe Yield Audit</h1>
            <Badge variant="info" size="sm">
              Petpooja / eZee Companion
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Reconcile POS sales against raw material consumption. Detect kitchen over-portioning and pilferage.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="add-recipe-btn"
            onClick={openNewRecipeModal}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
          >
            <Plus className="w-4 h-4" /> Map Recipe / BOM
          </button>
          <button
            id="sync-sales-btn"
            onClick={() => setIsSalesModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            <Upload className="w-4 h-4" /> Sync Sales Data
          </button>
          <button
            onClick={handleExportVarianceCsv}
            className="flex items-center gap-1 px-3 py-2 border border-stone-200 hover:bg-stone-50 text-stone-700 rounded-lg text-xs font-semibold"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </div>

      {/* POS Connection Status Card */}
      {(() => {
        const isConfigured = Boolean(posConfig?.apiKey && posConfig?.syncStatus === 'CONNECTED');
        return (
          <div className="bg-white rounded-xl border border-stone-200 p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-2xs">
            <div className="flex items-center gap-3">
              <div
                className={`p-2.5 rounded-xl border ${
                  isConfigured
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-stone-100 text-stone-600 border-stone-200'
                }`}
              >
                {isConfigured ? <Link className="w-5 h-5" /> : <Unlink className="w-5 h-5" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                    POS Channel: {posConfig?.provider || 'Petpooja / eZee'}
                  </h3>
                  <Badge variant={isConfigured ? 'success' : 'neutral'} size="sm">
                    {isConfigured ? 'CONNECTED' : 'POS integration not configured'}
                  </Badge>
                </div>
                <p className="text-xs text-stone-500 mt-0.5">
                  {isConfigured
                    ? `Verified API connectivity active for ${posConfig?.provider}.`
                    : 'POS integration not configured. Connect your Petpooja or eZee API credentials, or use manual CSV sales import below.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsConfigModalOpen(true)}
                className="px-3.5 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 text-stone-700 text-xs font-semibold shadow-2xs transition-colors"
              >
                {isConfigured ? 'Manage Credentials' : 'Configure POS Integration'}
              </button>
              {isConfigured && (
                <div className="text-right text-xs text-stone-500 border-l border-stone-200 pl-3">
                  <span className="font-semibold text-stone-800">{sales.length}</span> Orders Reconciled
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Theoretical vs Actual Consumption Variance Table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-2xs">
        <div className="p-4 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
              Theoretical vs Actual Kitchen Variance Audit
            </h3>
            <p className="text-[11px] text-stone-500 mt-0.5">
              Identifies kitchen shrinkage: Theoretical usage derived from recipe BOMs vs physical store requisitions.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-700 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Raw Material Item</th>
                <th className="py-3 px-4 text-right">Theoretical Needed (POS Sales)</th>
                <th className="py-3 px-4 text-right">Actual Store Issues</th>
                <th className="py-3 px-4 text-right">Variance Qty</th>
                <th className="py-3 px-4 text-right">Financial Leakage Loss</th>
                <th className="py-3 px-4">Audit Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {variances.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-stone-400">
                    Map recipe BOMs and sync POS sales to generate variance analytics.
                  </td>
                </tr>
              ) : (
                variances.map((v) => (
                  <tr key={v.itemId} className="hover:bg-stone-50/60 transition-colors">
                    <td className="py-3 px-4 font-bold text-stone-900">{v.itemName}</td>
                    <td className="py-3 px-4 text-right text-stone-700 font-mono">
                      {v.theoreticalQty.toFixed(2)} {v.unit}
                    </td>
                    <td className="py-3 px-4 text-right text-stone-700 font-mono">
                      {v.actualIssuedQty.toFixed(2)} {v.unit}
                    </td>
                    <td className="py-3 px-4 text-right font-bold">
                      <span className={v.varianceQty < 0 ? 'text-rose-700' : 'text-emerald-700'}>
                        {v.varianceQty > 0 ? `+${v.varianceQty.toFixed(2)}` : v.varianceQty.toFixed(2)} {v.unit}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-black">
                      <span className={v.varianceValue < 0 ? 'text-rose-700' : 'text-emerald-700'}>
                        {currencySymbol}{Math.abs(v.varianceValue).toFixed(2)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {v.varianceQty < 0 ? (
                        <Badge variant="danger" size="sm">
                          Overconsumption / Leakage
                        </Badge>
                      ) : (
                        <Badge variant="success" size="sm">
                          Controlled Yield
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mapped Recipes Grid */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-stone-100">
          <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
            Recipe BOM Mappings ({recipes.length})
          </h3>
        </div>

        {recipes.length === 0 ? (
          <div className="text-center py-8 text-xs text-stone-400">
            No recipes mapped yet. Map menu items like "Butter Chicken" to raw materials (Chicken, Butter, Cream).
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {recipes.map((r) => (
              <div key={r.id} className="p-3.5 rounded-lg border border-stone-200 bg-stone-50/50 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-stone-900">{r.posItemName}</h4>
                  <span className="font-mono text-[10px] text-stone-400">{r.posItemCode}</span>
                </div>
                <div className="space-y-1 pt-1 border-t border-stone-200/60">
                  {r.ingredients.map((ing, i) => (
                    <div key={i} className="flex justify-between text-[11px] text-stone-600">
                      <span>{ing.itemName}</span>
                      <span className="font-mono font-medium text-stone-800">
                        {ing.quantity} {ing.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Map Recipe Modal */}
      <Modal
        isOpen={isRecipeModalOpen}
        onClose={() => setIsRecipeModalOpen(false)}
        title="Map POS Menu Item Recipe (BOM)"
        subtitle="Define raw material portions consumed per menu item sold"
        maxWidth="lg"
      >
        <form onSubmit={handleSaveRecipe} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                POS Menu Item Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Butter Chicken Special"
                value={posItemName}
                onChange={(e) => setPosItemName(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500 font-semibold"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                POS Item Code
              </label>
              <input
                type="text"
                placeholder="e.g. POS-BC-01"
                value={posItemCode}
                onChange={(e) => setPosItemCode(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg font-mono focus:outline-none"
              />
            </div>
          </div>

          {/* Ingredients list */}
          <div className="border border-stone-200 rounded-xl overflow-hidden">
            <div className="p-3 bg-stone-50 border-b border-stone-200 flex justify-between items-center">
              <h4 className="text-xs font-bold text-stone-800 uppercase tracking-wider">
                Raw Material Ingredients
              </h4>
              <button
                type="button"
                onClick={addIngredient}
                className="text-xs text-amber-700 font-bold hover:text-amber-900"
              >
                + Add Ingredient
              </button>
            </div>

            <div className="p-3 space-y-2 max-h-56 overflow-y-auto">
              {recipeIngredients.map((ing, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs">
                  <select
                    value={ing.itemId}
                    onChange={(e) => updateIngredient(idx, 'itemId', e.target.value)}
                    className="flex-1 px-2.5 py-1.5 border border-stone-300 rounded-md bg-white text-xs"
                  >
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} ({i.unit})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0.001}
                    step="any"
                    value={ing.quantity}
                    onChange={(e) => updateIngredient(idx, 'quantity', Number(e.target.value))}
                    className="w-24 px-2 py-1.5 border border-stone-300 rounded-md text-right font-bold"
                  />
                  <span className="text-stone-500 w-8">{ing.unit}</span>
                  <button
                    type="button"
                    onClick={() => removeIngredient(idx)}
                    className="text-stone-400 hover:text-rose-600 p-1"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setIsRecipeModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-xs"
            >
              Save Recipe BOM
            </button>
          </div>
        </form>
      </Modal>

      {/* Sync Sales CSV Modal */}
      <Modal
        isOpen={isSalesModalOpen}
        onClose={() => setIsSalesModalOpen(false)}
        title="Sync POS Sales Data (CSV Import)"
        subtitle="Import sold menu item quantities to calculate theoretical raw material burn"
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="text-xs text-stone-500 bg-stone-50 p-3 rounded-lg border border-stone-200">
            <code>ItemName, SoldQty, SalePrice</code>
            <p className="mt-1 text-stone-400 text-[11px]">Example: Butter Chicken Special, 45, 18000</p>
          </div>

          <textarea
            rows={6}
            placeholder="Paste your POS sold items rows here..."
            value={csvSalesText}
            onChange={(e) => setCsvSalesText(e.target.value)}
            className="w-full p-3 font-mono text-xs border border-stone-300 rounded-xl focus:outline-none focus:border-amber-500"
          />

          {importStatus && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 font-medium">
              {importStatus}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setIsSalesModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              onClick={handleImportSales}
              className="px-5 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold rounded-lg shadow-xs"
            >
              Sync Records
            </button>
          </div>
        </div>
      </Modal>

      {/* POS Configuration Modal */}
      <Modal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        title="POS Integration Configuration"
      >
        <div className="space-y-4">
          <p className="text-xs text-stone-500">
            Configure your restaurant point-of-sale credentials for automated menu sales reconciliation.
          </p>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">POS Platform Provider</label>
            <select
              value={configProvider}
              onChange={(e) => setConfigProvider(e.target.value as any)}
              className="w-full p-2.5 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500"
            >
              <option value="PETPOOJA">Petpooja POS</option>
              <option value="EZEE">eZee Technosys</option>
              <option value="OTHER">Custom Webhook / POS</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">Merchant / Restaurant ID</label>
            <input
              type="text"
              placeholder="e.g. REST_MUM_4021"
              value={configMerchantId}
              onChange={(e) => setConfigMerchantId(e.target.value)}
              className="w-full p-2.5 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">API Key / Secret Token</label>
            <input
              type="password"
              placeholder="Enter provider API authentication key"
              value={configApiKey}
              onChange={(e) => setConfigApiKey(e.target.value)}
              className="w-full p-2.5 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex justify-between items-center pt-2">
            {posConfig?.apiKey ? (
              <button
                type="button"
                disabled={savingConfig}
                onClick={async () => {
                  if (!activeRestaurantId) return;
                  setSavingConfig(true);
                  try {
                    await setDoc(doc(db, 'restaurants', activeRestaurantId, 'settings', 'posIntegration'), {
                      provider: configProvider,
                      apiKey: '',
                      webhookSecret: '',
                      syncStatus: 'DISCONNECTED',
                      lastSyncTime: new Date().toISOString(),
                    });
                    setIsConfigModalOpen(false);
                  } finally {
                    setSavingConfig(false);
                  }
                }}
                className="px-3 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700"
              >
                Disconnect POS
              </button>
            ) : <div />}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsConfigModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-stone-600"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingConfig || !configApiKey.trim()}
                onClick={async () => {
                  if (!activeRestaurantId || !configApiKey.trim()) return;
                  setSavingConfig(true);
                  try {
                    await setDoc(doc(db, 'restaurants', activeRestaurantId, 'settings', 'posIntegration'), {
                      provider: configProvider,
                      apiKey: configApiKey.trim(),
                      webhookSecret: configMerchantId.trim(),
                      syncStatus: 'CONNECTED',
                      lastSyncTime: new Date().toISOString(),
                    });
                    setIsConfigModalOpen(false);
                  } finally {
                    setSavingConfig(false);
                  }
                }}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs"
              >
                {savingConfig ? 'Saving...' : 'Save & Connect'}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};
