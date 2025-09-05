import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CategoryResponseDTO {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  categoryImage?: string | null;
}
