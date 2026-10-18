import { ArrayNotEmpty, IsArray, IsIn, IsNotEmpty, IsString } from 'class-validator';

export class EnrollmentOperationDto {
  @IsArray()
  @ArrayNotEmpty()
  ids: Array<string | number>;

  @IsNotEmpty()
  @IsString()
  @IsIn(['Update', 'Disable'], {
    message: 'operation must be Update or Disable',
  })
  operation: 'Update' | 'Disable';
}
