import type { Prisma } from 'generated/prisma';

export const catalogTextFields = {
  primary_material: 'primaryMaterial',
  wood_treatment: 'woodTreatment',
  finish: 'finish',
  origin_of_material: 'originOfMaterial',
  unit_of_measure: 'unitOfMeasure',
  weight_unit: 'weightUnit',
  storage_capacity: 'storageCapacity',
  style: 'style',
  texture: 'texture',
  design_inspiration: 'designInspiration',
  pattern: 'pattern',
  care_instructions: 'careInstructions',
  warranty: 'warranty',
  unique_identifier: 'uniqueIdentifier',
  designer: 'designer',
  story: 'story',
} as const;

export const catalogListFields = {
  secondary_materials: 'secondaryMaterials',
  craftsmanship_details: 'craftsmanshipDetails',
  features: 'features',
} as const;

export const catalogDecimalFields = [
  'width',
  'depth',
  'height',
  'weight',
] as const;

export const catalogDetailColumns = [
  ...Object.values(catalogTextFields),
  ...Object.values(catalogListFields),
  ...catalogDecimalFields,
  'handmade',
  'assemblyRequired',
  'seatingCapacity',
  'creationDate',
] as const satisfies readonly (keyof Prisma.ProductUncheckedCreateInput)[];

export const spreadsheetFormulaPrefix = /^'*(?:\s*[=+@-]|[\t\r\n])/;
