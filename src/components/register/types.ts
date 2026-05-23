export type CheckoutOptions = {
  subtotal?: number;
  total?: number;
  discountAmount?: number;
  discountType?: 'FIXED' | 'PERCENT' | 'PRODUCT';
  amountTendered?: number;
  changeGiven?: number;
  mpesaRef?: string;
  mpesaCustomer?: string;
  mpesaCheckoutRequestId?: string;
  pdqRef?: string;
  paymentReference?: string;
  customerId?: string;
  customerName?: string;
  splitPayments?: {
    cashAmount: number;
    secondaryAmount: number;
    secondaryMethod: 'MPESA' | 'PDQ' | 'CREDIT';
    secondaryReference?: string;
  };
};

export type RegisterCheckoutHandler = (
  status: 'PAID' | 'UNPAID',
  method: string,
  options?: CheckoutOptions
) => Promise<any>;
