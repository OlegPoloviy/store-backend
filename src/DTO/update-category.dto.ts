import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';

export class UpdateCategoryDTO {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  name?: string;
}
