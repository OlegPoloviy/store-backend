import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DmsService } from './dms.service';

describe('DmsService', () => {
  let service: DmsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DmsService,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            SUPABASE_URL: 'https://example.invalid',
            SUPABASE_ANON_KEY: 'test.test.test',
            SUPABASE_SERVICE_ROLE_KEY: 'test.test.test',
          }),
        },
      ],
    }).compile();

    service = module.get<DmsService>(DmsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
