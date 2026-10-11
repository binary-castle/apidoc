import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common'
import { ApiCreatedResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger'

export class CreateCustomerDto {
  @ApiProperty({ format: 'email', example: 'ada@example.com' })
  email: string

  @ApiPropertyOptional({ maxLength: 120, example: 'Ada Lovelace' })
  name?: string
}

export class Customer {
  @ApiProperty({ example: 1 })
  id: number

  @ApiProperty({ format: 'email' })
  email: string

  @ApiProperty({ type: String, nullable: true })
  name: string | null

  @ApiProperty({ description: 'Unix timestamp.' })
  created: number
}

@ApiTags('Customers')
@Controller('customers')
export class CustomersController {
  private readonly customers = new Map<number, Customer>()
  private nextId = 1

  @Get()
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 } })
  @ApiOkResponse({ type: [Customer] })
  list(@Query('limit') limit?: string): Customer[] {
    return [...this.customers.values()].reverse().slice(0, Math.min(Math.max(Number(limit) || 10, 1), 100))
  }

  @Post()
  @ApiCreatedResponse({ type: Customer })
  create(@Body() body: CreateCustomerDto): Customer {
    const customer = { id: this.nextId++, email: body.email, name: body.name ?? null, created: Math.floor(Date.now() / 1000) }
    this.customers.set(customer.id, customer)
    return customer
  }

  @Get(':id')
  @ApiOkResponse({ type: Customer })
  @ApiNotFoundResponse({ description: 'No such customer.' })
  get(@Param('id', ParseIntPipe) id: number): Customer {
    const customer = this.customers.get(id)
    if (!customer) throw new NotFoundException('No such customer.')
    return customer
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiNotFoundResponse({ description: 'No such customer.' })
  remove(@Param('id', ParseIntPipe) id: number): void {
    if (!this.customers.delete(id)) throw new NotFoundException('No such customer.')
  }
}
