export interface PaymentCallback {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{
          Name: string;
          Value: string | number;
        }>;
      };
    };
  };
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  message: string;
  mpesaReceiptNumber?: string;
  phoneNumber?: string;
  amount?: number;
}

export class MPesaCallbackService {
  async handlePaymentCallback(callbackData: PaymentCallback): Promise<PaymentResult> {
    const stkCallback = callbackData.Body.stkCallback;
    
    if (stkCallback.ResultCode === 0) {
      // Payment successful
      const metadata = stkCallback.CallbackMetadata?.Item || [];
      const mpesaReceiptNumber = metadata.find(item => item.Name === 'MpesaReceiptNumber')?.Value as string;
      const amount = metadata.find(item => item.Name === 'Amount')?.Value as number;
      const phoneNumber = metadata.find(item => item.Name === 'PhoneNumber')?.Value as string;

      // In a real implementation, you would update the database here
      // For now, we'll just log and return success
      console.log('M-Pesa payment successful:', {
        mpesaReceiptNumber,
        amount,
        phoneNumber,
        checkoutRequestId: stkCallback.CheckoutRequestID,
      });

      return {
        success: true,
        message: 'Payment completed successfully',
        mpesaReceiptNumber,
        phoneNumber,
        amount,
      };
    } else {
      // Payment failed
      console.warn('M-Pesa payment failed:', stkCallback.ResultDesc);
      return {
        success: false,
        message: stkCallback.ResultDesc || 'Payment failed',
      };
    }
  }
}

export const mpesaCallbackService = new MPesaCallbackService();