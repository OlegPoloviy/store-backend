import {
  IsString,
  IsNumber,
  IsOptional,
  IsPositive,
  MaxLength,
  IsBoolean,
  IsArray,
  IsUUID,
  IsDateString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ProductImageDTO {
  @IsString()
  url: string;

  @IsString()
  @IsOptional()
  alt?: string;
}

export class CreateProductDTO {
  // Basic info
  @IsString()
  @MaxLength(100)
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsString()
  price: string;

  @IsString()
  currency: string;

  // Materials & craftsmanship
  @IsString()
  @IsOptional()
  primaryMaterial?: string;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  secondaryMaterials?: string[];

  @IsString()
  @IsOptional()
  woodTreatment?: string;

  @IsString()
  @IsOptional()
  finish?: string;

  @IsString()
  @IsOptional()
  originOfMaterial?: string;

  @IsBoolean()
  @IsOptional()
  handmade?: boolean;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  craftsmanshipDetails?: string[];

  // Dimensions
  @IsString()
  @IsOptional()
  width?: string;

  @IsString()
  @IsOptional()
  depth?: string;

  @IsString()
  @IsOptional()
  height?: string;

  @IsString()
  @IsOptional()
  unitOfMeasure?: string;

  @IsString()
  @IsOptional()
  weight?: string;

  @IsString()
  @IsOptional()
  weightUnit?: string;

  @IsNumber()
  @IsOptional()
  seatingCapacity?: number;

  @IsString()
  @IsOptional()
  storageCapacity?: string;

  // Style & design
  @IsString()
  @IsOptional()
  style?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  texture?: string;

  @IsString()
  @IsOptional()
  designInspiration?: string;

  @IsString()
  @IsOptional()
  pattern?: string;

  // Features
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  features?: string[];

  @IsBoolean()
  @IsOptional()
  assemblyRequired?: boolean;

  @IsString()
  @IsOptional()
  careInstructions?: string;

  @IsString()
  @IsOptional()
  warranty?: string;

  // Metadata
  @IsString()
  @IsOptional()
  uniqueIdentifier?: string;

  @IsString()
  @IsOptional()
  designer?: string;

  @IsDateString()
  @IsOptional()
  creationDate?: string;

  @IsString()
  @IsOptional()
  story?: string;

  // Relations
  @IsString()
  category: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDTO)
  @IsOptional()
  images?: ProductImageDTO[];
}
