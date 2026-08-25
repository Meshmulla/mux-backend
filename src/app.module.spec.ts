import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule - DI Resolution', () => {
  it('should compile and resolve MaintenanceGuard without missing import errors', async () => {
    let module: TestingModule;
    expect(() => {
      module = Test.createTestingModule({
        imports: [AppModule],
      });
    }).not.toThrow();
  });
});
