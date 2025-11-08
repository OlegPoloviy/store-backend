import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { User } from 'generated/prisma';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private readonly prismaService: PrismaService) {}

  async getAllUsers(): Promise<User[]> {
    try {
      const users = await this.prismaService.user.findMany();
      return users;
    } catch (error) {
      throw new InternalServerErrorException('Error getting all users!');
    }
  }

  async deleteUser(userId: string): Promise<void> {
    try {
      await this.prismaService.user.delete({
        where: {
          id: userId,
        },
      });
    } catch (error) {
      throw new InternalServerErrorException(
        `Error deleting user with id of ${userId}`,
      );
    }
  }
}
