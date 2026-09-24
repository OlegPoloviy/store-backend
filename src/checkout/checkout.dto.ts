import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class CreateCheckoutDto {
  @IsEmail()
  @MaxLength(254)
  customerEmail: string;

  @IsString()
  @Length(1, 100)
  customerFirstName: string;

  @IsString()
  @Length(1, 100)
  customerLastName: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  customerPhone?: string;

  @IsString()
  @Matches(/^[A-Z]{2}$/)
  shippingCountry: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  shippingAddress: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  shippingCity: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  shippingRegion?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  shippingPostalCode: string;
}
