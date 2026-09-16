import React, { useState } from 'react';
import { Store, Globe, Layers, CheckCircle, ArrowRight, Loader2, Plus, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { createRestaurantWithDefaults } from '../services/restaurantService';

interface OnboardingViewProps {
  onComplete?: () => void;
}

export const OnboardingView: React.FC<OnboardingViewProps> = ({ onComplete }) => {
  const { user, userProfile, refreshRestaurants } = useAuth();

  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [country, setCountry] = useState('India');
  const [currency, setCurrency] = useState('INR');
  const [currencySymbol, setCurrencySymbol] = useState('₹');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [taxSystem, setTaxSystem] = useState('GST (5% / 18%)');
  const [numberOfOutlets, setNumberOfOutlets] = useState(1);

  // Departments
  const defaultDepartmentOptions = [
    'Indian Kitchen',
    'Chinese Kitchen',
    'Tandoor Section',
    'Bar & Beverages',
    'Bakery & Pastry',
    'General Dry Store',
    'Housekeeping & Cleaning',
    'Packaging & Disposables',
  ];
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([
    'Indian Kitchen',
    'Chinese Kitchen',
    'Tandoor Section',
    'Bar & Beverages',
    'General Dry Store',
  ]);
  const [customDeptInput, setCustomDeptInput] = useState('');

  const handleCountryChange = (c: string) => {
    setCountry(c);
    if (c === 'India') {
      setCurrency('INR');
      setCurrencySymbol('₹');
      setTimezone('Asia/Kolkata');
      setTaxSystem('GST (5% / 18%)');
    } else if (c === 'UAE') {
      setCurrency('AED');
      setCurrencySymbol('AED');
      setTimezone('Asia/Dubai');
      setTaxSystem('VAT (5%)');
    } else if (c === 'USA') {
      setCurrency('USD');
      setCurrencySymbol('$');
      setTimezone('America/New_York');
      setTaxSystem('Sales Tax (State)');
    } else if (c === 'UK') {
      setCurrency('GBP');
      setCurrencySymbol('£');
      setTimezone('Europe/London');
      setTaxSystem('VAT (20%)');
    } else {
      setCurrency('USD');
      setCurrencySymbol('$');
      setTimezone('UTC');
      setTaxSystem('Standard Tax');
    }
  };

  const toggleDepartment = (dept: string) => {
    if (selectedDepartments.includes(dept)) {
      if (selectedDepartments.length > 1) {
        setSelectedDepartments(selectedDepartments.filter((d) => d !== dept));
      }
    } else {
      setSelectedDepartments([...selectedDepartments, dept]);
    }
  };

  const addCustomDepartment = () => {
    if (customDeptInput.trim() && !selectedDepartments.includes(customDeptInput.trim())) {
      setSelectedDepartments([...selectedDepartments, customDeptInput.trim()]);
      setCustomDeptInput('');
    }
  };

  const handleCreateRestaurant = async () => {
    if (!name.trim()) {
      setError('Please enter your restaurant name.');
      return;
    }
    if (!user) {
      setError('You must be signed in.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      await createRestaurantWithDefaults(
        user.uid,
        userProfile?.name || user.displayName || 'Owner',
        user.email || undefined,
        {
          name: name.trim(),
          address: address.trim(),
          country,
          currency,
          currencySymbol,
          timezone,
          taxSystem,
          numberOfOutlets,
          departments: selectedDepartments,
        }
      );

      await refreshRestaurants();
      if (onComplete) {
        onComplete();
      }
    } catch (err: any) {
      console.error('Restaurant setup failed:', err);
      setError(err?.message || 'Failed to setup restaurant. Please check connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-xl text-center">
        <div className="w-12 h-12 bg-amber-500 rounded-xl mx-auto flex items-center justify-center text-stone-950 font-black shadow-xs mb-3">
          RC
        </div>
        <h2 className="text-2xl font-black text-stone-900 tracking-tight">
          Welcome to Restaurant Store Control
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          Setup your outlet profile, regional taxes, and kitchen departments in 2 minutes.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-xl">
        <div className="bg-white py-8 px-6 shadow-sm rounded-2xl border border-stone-200 sm:px-10">
          {/* Step Indicator */}
          <div className="flex items-center justify-between mb-8 pb-4 border-b border-stone-100">
            <div className="flex items-center gap-2">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  step === 1 ? 'bg-amber-600 text-white' : 'bg-emerald-600 text-white'
                }`}
              >
                1
              </span>
              <span className="text-xs font-bold text-stone-900 uppercase tracking-wide">
                Outlet Profile
              </span>
            </div>
            <div className="h-[2px] w-12 bg-stone-200" />
            <div className="flex items-center gap-2">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  step === 2 ? 'bg-amber-600 text-white' : 'bg-stone-200 text-stone-600'
                }`}
              >
                2
              </span>
              <span className="text-xs font-bold text-stone-900 uppercase tracking-wide">
                Departments & Stock
              </span>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
              {error}
            </div>
          )}

          {step === 1 ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                  Restaurant / Outlet Name *
                </label>
                <input
                  id="restaurant-name-input"
                  type="text"
                  required
                  placeholder="e.g. Copper Chimney Fine Dine"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-xl focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                  Location / Address
                </label>
                <input
                  id="restaurant-address-input"
                  type="text"
                  placeholder="e.g. Indiranagar 100ft Road, Bangalore"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-xl focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                    Country
                  </label>
                  <select
                    id="country-select"
                    value={country}
                    onChange={(e) => handleCountryChange(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-xl bg-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="India">India</option>
                    <option value="UAE">United Arab Emirates</option>
                    <option value="USA">United States</option>
                    <option value="UK">United Kingdom</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                    Currency & Symbol
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-2/3 px-3 py-2 text-sm border border-stone-300 rounded-xl focus:outline-none focus:border-amber-500"
                      placeholder="INR"
                    />
                    <input
                      type="text"
                      value={currencySymbol}
                      onChange={(e) => setCurrencySymbol(e.target.value)}
                      className="w-1/3 px-3 py-2 text-sm border border-stone-300 rounded-xl text-center font-bold focus:outline-none focus:border-amber-500"
                      placeholder="₹"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                    Tax System
                  </label>
                  <input
                    type="text"
                    value={taxSystem}
                    onChange={(e) => setTaxSystem(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-xl focus:outline-none focus:border-amber-500"
                    placeholder="GST, VAT, Sales Tax"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                    Outlets Count
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={numberOfOutlets}
                    onChange={(e) => setNumberOfOutlets(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-xl focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  id="onboarding-step1-next-btn"
                  onClick={() => {
                    if (!name.trim()) {
                      setError('Please enter restaurant name to continue.');
                      return;
                    }
                    setError(null);
                    setStep(2);
                  }}
                  className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-xs"
                >
                  <span>Configure Departments</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h4 className="text-xs font-bold text-stone-700 uppercase tracking-wider mb-2">
                  Select Kitchen & Store Departments
                </h4>
                <p className="text-xs text-stone-500 mb-3">
                  Click to include departments that receive daily stock from the main store:
                </p>

                <div className="flex flex-wrap gap-2">
                  {defaultDepartmentOptions.map((dept) => {
                    const isSelected = selectedDepartments.includes(dept);
                    return (
                      <button
                        key={dept}
                        type="button"
                        onClick={() => toggleDepartment(dept)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          isSelected
                            ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                            : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                        }`}
                      >
                        {isSelected && '✓ '}
                        {dept}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Add Custom Department */}
              <div>
                <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                  Add Custom Department
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. Sushi Bar, Butchery, Banquet"
                    value={customDeptInput}
                    onChange={(e) => setCustomDeptInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomDepartment())}
                    className="flex-1 px-3 py-2 text-sm border border-stone-300 rounded-xl focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={addCustomDepartment}
                    className="px-4 py-2 bg-stone-800 hover:bg-stone-900 text-white text-xs font-semibold rounded-xl"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Summary of Selected */}
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-xs text-stone-600">
                <span className="font-semibold text-stone-900">Active Departments ({selectedDepartments.length}): </span>
                <span>{selectedDepartments.join(', ')}</span>
              </div>

              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>14-Day Free Trial will be activated automatically. No credit card required.</span>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2 text-stone-600 hover:text-stone-900 text-xs font-semibold"
                >
                  ← Back to Profile
                </button>
                <button
                  id="launch-restaurant-btn"
                  onClick={handleCreateRestaurant}
                  disabled={loading}
                  className="flex items-center gap-2 px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-xs disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  <span>Launch Restaurant Store</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
