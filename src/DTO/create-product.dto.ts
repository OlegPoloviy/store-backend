import {
  IsString,
  IsNumber,
  IsOptional,
  IsPositive,
  MaxLength,
} from 'class-validator';

export class CreateProductDTO {
  @IsString()
  @MaxLength(100)
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  // @IsNumber()
  // @IsPositive()
  @IsString()
  @IsOptional()
  price: string;

  @IsString()
  @IsOptional()
  material: string;

  @IsString()
  currency: string;

  @IsString()
  category: string;
}
