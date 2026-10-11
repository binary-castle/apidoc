import 'reflect-metadata'
import { ApidocModule } from '@binarycastle/apidoc-nestjs'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { CustomersController } from './customers.js'

@Module({ controllers: [CustomersController] })
class AppModule {}

const app = await NestFactory.create(AppModule)
app.setGlobalPrefix('api')

const config = new DocumentBuilder()
  .setTitle('Orbit Customers (NestJS)')
  .setDescription('An in-memory API documented by `@nestjs/swagger` and rendered by `@binarycastle/apidoc-nestjs`.')
  .setVersion('1.0.0')
  .build()
const document = SwaggerModule.createDocument(app, config)

// apidoc at /docs; Swagger UI stays available at /swagger for comparison.
ApidocModule.setup('docs', app, document)
SwaggerModule.setup('swagger', app, document)

const port = Number(process.env.PORT) || 3001
await app.listen(port)
console.log(`Docs: http://localhost:${port}/docs/`)
