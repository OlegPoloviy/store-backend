import { Controller, Delete, Get, Body } from '@nestjs/common';
import { AdminGuard } from 'src/guards/admin.guard';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserService } from './user.service';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @Get('/')
  getAllUsers() {
    return this.userService.getAllUsers();
  }

  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @Delete('/delete')
  deleteUser(@Body() body: { userId: string }) {
    return this.userService.deleteUser(body.userId);
  }
}
