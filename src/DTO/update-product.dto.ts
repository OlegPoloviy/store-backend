import { CreateProductDTO } from './create-product.dto';

export class UpdateProductDTO implements Partial<CreateProductDTO> {
  title?: string;
  description?: string;
  price?: string;
  currency?: string;
  primaryMaterial?: string;
  secondaryMaterials?: string[];
  woodTreatment?: string;
  finish?: string;
  originOfMaterial?: string;
  handmade?: boolean;
  craftsmanshipDetails?: string[];
  width?: string;
  depth?: string;
  height?: string;
  unitOfMeasure?: string;
  weight?: string;
  weightUnit?: string;
  seatingCapacity?: number;
  storageCapacity?: string;
  style?: string;
  color?: string;
  texture?: string;
  designInspiration?: string;
  pattern?: string;
  features?: string[];
  assemblyRequired?: boolean;
  careInstructions?: string;
  warranty?: string;
  uniqueIdentifier?: string;
  designer?: string;
  creationDate?: string;
  story?: string;
  category?: string;
  images?: {
    url: string;
    alt?: string;
  }[];
}
