'use client';

import { useState, type FormEvent } from 'react';
import { strings } from '@/lib/strings';
import {
  MATERIAL_CATEGORIES,
  MEASUREMENT_MODELS,
  MEASUREMENT_MODEL_LABELS,
  PRICE_UNIT_LABELS,
  type MeasurementModel,
} from '@/lib/materials/schema';

export type MaterialFormValues = {
  id?: string;
  name: string;
  category: string;
  customCategory: boolean;
  supplier: string;
  measurementModel: MeasurementModel;
  standardLengthMm: string;
  sheetWidthMm: string;
  sheetHeightMm: string;
  thicknessMm: string;
  priceMajor: string;
  notes: string;
};

export const emptyMaterialForm = (): MaterialFormValues => ({
  name: '',
  category: MATERIAL_CATEGORIES[0],
  customCategory: false,
  supplier: '',
  measurementModel: 'sheet',
  standardLengthMm: '',
  sheetWidthMm: '',
  sheetHeightMm: '',
  thicknessMm: '',
  priceMajor: '',
  notes: '',
});

const labelClass = 'block text-sm font-medium';
const inputClass =
  'mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60';

export function MaterialForm({
  initial,
  currency,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial: MaterialFormValues;
  currency: string;
  pending: boolean;
  error: string | null;
  onSubmit: (values: MaterialFormValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<MaterialFormValues>(initial);

  const set = <K extends keyof MaterialFormValues>(key: K, value: MaterialFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(values);
  }

  const isLinear = values.measurementModel === 'linear';
  const isSheet = values.measurementModel === 'sheet';

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-line p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="m-name" className={labelClass}>
            {strings.materials.fields.name}
          </label>
          <input
            id="m-name"
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder={strings.materials.fields.namePlaceholder}
            maxLength={160}
            disabled={pending}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="m-category" className={labelClass}>
            {strings.materials.fields.category}
          </label>
          {values.customCategory ? (
            <input
              id="m-category"
              value={values.category}
              onChange={(e) => set('category', e.target.value)}
              maxLength={80}
              disabled={pending}
              className={inputClass}
            />
          ) : (
            <select
              id="m-category"
              value={values.category}
              onChange={(e) => set('category', e.target.value)}
              disabled={pending}
              className={inputClass}
            >
              {MATERIAL_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          )}
          <label className="mt-2 flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={values.customCategory}
              onChange={(e) => {
                set('customCategory', e.target.checked);
                if (!e.target.checked) set('category', MATERIAL_CATEGORIES[0]);
                else set('category', '');
              }}
              disabled={pending}
            />
            {strings.materials.fields.customCategory}
          </label>
        </div>

        <div>
          <label htmlFor="m-supplier" className={labelClass}>
            {strings.materials.fields.supplier}
          </label>
          <input
            id="m-supplier"
            value={values.supplier}
            onChange={(e) => set('supplier', e.target.value)}
            maxLength={160}
            disabled={pending}
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="m-model" className={labelClass}>
            {strings.materials.fields.measurementModel}
          </label>
          <select
            id="m-model"
            value={values.measurementModel}
            onChange={(e) => set('measurementModel', e.target.value as MeasurementModel)}
            disabled={pending}
            className={inputClass}
          >
            {MEASUREMENT_MODELS.map((model) => (
              <option key={model} value={model}>
                {MEASUREMENT_MODEL_LABELS[model]}
              </option>
            ))}
          </select>
        </div>

        {/* Only the dimensions this measurement model actually uses are shown,
            so the form cannot invite a sheet width on a bar. */}
        {isLinear ? (
          <div>
            <label htmlFor="m-length" className={labelClass}>
              {strings.materials.fields.standardLength}
            </label>
            <input
              id="m-length"
              type="number"
              min={1}
              value={values.standardLengthMm}
              onChange={(e) => set('standardLengthMm', e.target.value)}
              disabled={pending}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-ink-muted">{strings.materials.fields.standardLengthHint}</p>
          </div>
        ) : null}

        {isSheet ? (
          <>
            <div>
              <label htmlFor="m-width" className={labelClass}>
                {strings.materials.fields.sheetWidth}
              </label>
              <input
                id="m-width"
                type="number"
                min={1}
                value={values.sheetWidthMm}
                onChange={(e) => set('sheetWidthMm', e.target.value)}
                disabled={pending}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="m-height" className={labelClass}>
                {strings.materials.fields.sheetHeight}
              </label>
              <input
                id="m-height"
                type="number"
                min={1}
                value={values.sheetHeightMm}
                onChange={(e) => set('sheetHeightMm', e.target.value)}
                disabled={pending}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-ink-muted">{strings.materials.fields.sheetHint}</p>
            </div>
          </>
        ) : null}

        <div>
          <label htmlFor="m-thickness" className={labelClass}>
            {strings.materials.fields.thickness}
          </label>
          <input
            id="m-thickness"
            type="number"
            step="0.01"
            min={0}
            value={values.thicknessMm}
            onChange={(e) => set('thicknessMm', e.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="m-price" className={labelClass}>
            {strings.materials.fields.price} ({currency} {PRICE_UNIT_LABELS[values.measurementModel]})
          </label>
          <input
            id="m-price"
            type="number"
            step="0.01"
            min={0}
            value={values.priceMajor}
            onChange={(e) => set('priceMajor', e.target.value)}
            disabled={pending}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-ink-muted">{strings.materials.fields.priceHint}</p>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="m-notes" className={labelClass}>
            {strings.materials.fields.notes}
          </label>
          <textarea
            id="m-notes"
            value={values.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={2}
            maxLength={2000}
            disabled={pending}
            className={inputClass}
          />
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? strings.materials.saving : strings.materials.save}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
        >
          {strings.materials.cancel}
        </button>
      </div>
    </form>
  );
}
