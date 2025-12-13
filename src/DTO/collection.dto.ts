import {
  IsString,
  IsBoolean,
  IsUUID,
  IsDate,
  IsOptional,
} from 'class-validator';

export class CollectionInputDTO {
  @IsString()
  name: string;

  @IsBoolean()
  isPrivate: boolean;
}

export class CollectionDTO {
  @IsUUID()
  userID: string;

  @IsString()
  name: string;

  @IsBoolean()
  isPrivate: boolean;

  @IsOptional()
  @IsDate()
  createdAt?: Date;
}
