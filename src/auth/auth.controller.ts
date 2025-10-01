import { Controller, Post, Body } from '@nestjs/common';
import { LoginDTO } from 'src/DTO/login.dto';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  login(@Body() data: LoginDTO): Promise<string> {
    return this.authService.validateUser(data);
  }
}
