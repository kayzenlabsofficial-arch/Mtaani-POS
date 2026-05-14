import { db, type Transaction } from '../db';

export interface MPesaConfig {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  callbackUrl: string;
  environment: 'sandbox' | 'production';
}

export interface STKPushRequest {
  phoneNumber: string;
  amount: number;
  accountReference: string;
  transactionDesc: string;
}

export interface STKPushResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
}

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

export class MPesaService {
  private config: MPesaConfig;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: MPesaConfig) {
    this.config = config;
  }

  private async getAccessToken(): Promise<string> {
    // Check if we have a valid token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const auth = btoa(`${this.config.consumerKey}:${this.config.consumerSecret}`);
    const url = this.config.environment === 'sandbox'
      ? 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
      : 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get access token: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { access_token: string; expires_in: number };
      this.accessToken = data.access_token;
      this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Expire 1 minute early
      
      return this.accessToken;
    } catch (error) {
      console.error('MPesa access token error:', error);
      throw new Error('Failed to authenticate with M-Pesa API');
    }
  }

  private generatePassword(timestamp: string): string {
    const password = btoa(`${this.config.shortcode}${this.config.passkey}${timestamp}`);
    return password;
  }

  async initiateSTKPush(request: STKPushRequest): Promise<STKPushResponse> {
    try {
      const token = await this.getAccessToken();
      const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, -3);
      const password = this.generatePassword(timestamp);

      const phoneNumber = this.formatPhoneNumber(request.phoneNumber);
      
      const stkRequest = {
        BusinessShortCode: this.config.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: request.amount,
        PartyA: phoneNumber,
        PartyB: this.config.shortcode,
        PhoneNumber: phoneNumber,
        CallBackURL: this.config.callbackUrl,
        AccountReference: request.accountReference,
        TransactionDesc: request.transactionDesc,
      };

      const url = this.config.environment === 'sandbox'
        ? 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
        : 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(stkRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`STK Push failed: ${response.status} - ${errorText}`);
      }

      const data: STKPushResponse = await response.json();
      
      if (data.ResponseCode !== '0') {
        throw new Error(`M-Pesa error: ${data.ResponseDescription}`);
      }

      return data;
    } catch (error) {
      console.error('STK Push error:', error);
      throw error;
    }
  }

  async handlePaymentCallback(callbackData: PaymentCallback): Promise<PaymentResult> {
    const stkCallback = callbackData.Body.stkCallback;
    
    if (stkCallback.ResultCode === 0) {
      // Payment successful
      const metadata = stkCallback.CallbackMetadata?.Item || [];
      const mpesaReceiptNumber = metadata.find(item => item.Name === 'MpesaReceiptNumber')?.Value as string;
      const amount = metadata.find(item => item.Name === 'Amount')?.Value as number;
      const phoneNumber = metadata.find(item => item.Name === 'PhoneNumber')?.Value as string;

      // Find the transaction by CheckoutRequestID and update it
      try {
        const transactions = await db.transactions
          .where('mpesaCheckoutRequestId')
          .equals(stkCallback.CheckoutRequestID)
          .toArray();

        if (transactions.length > 0) {
          const transaction = transactions[0];
          await db.transactions.update(transaction.id, {
            status: 'PAID',
            mpesaReceiptNumber,
            paymentMethod: 'MPESA',
          });

          return {
            success: true,
            transactionId: transaction.id,
            message: 'Payment completed successfully',
            mpesaReceiptNumber,
            phoneNumber,
            amount,
          };
        }
      } catch (error) {
        console.error('Error updating transaction:', error);
      }

      return {
        success: true,
        message: 'Payment completed successfully but transaction not found',
        mpesaReceiptNumber,
        phoneNumber,
        amount,
      };
    } else {
      // Payment failed
      return {
        success: false,
        message: stkCallback.ResultDesc || 'Payment failed',
      };
    }
  }

  async checkTransactionStatus(checkoutRequestId: string): Promise<PaymentResult> {
    try {
      const token = await this.getAccessToken();
      const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, -3);
      const password = this.generatePassword(timestamp);

      const queryRequest = {
        BusinessShortCode: this.config.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      };

      const url = this.config.environment === 'sandbox'
        ? 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query'
        : 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query';

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(queryRequest),
      });

      if (!response.ok) {
        throw new Error(`Transaction query failed: ${response.status}`);
      }

      const data = await response.json() as { ResultCode?: string | number; ResultDesc?: string };
      
      if (data.ResultCode === '0') {
        return {
          success: true,
          message: 'Transaction completed successfully',
        };
      } else {
        return {
          success: false,
          message: data.ResultDesc || 'Transaction failed or pending',
        };
      }
    } catch (error) {
      console.error('Transaction status check error:', error);
      return {
        success: false,
        message: 'Failed to check transaction status',
      };
    }
  }

  private formatPhoneNumber(phone: string): string {
    // Format phone number to 254 format
    let formatted = phone.replace(/\s+/g, '').replace(/^0/, '254');
    if (!formatted.startsWith('254')) {
      formatted = `254${formatted}`;
    }
    return formatted;
  }

  // Retry mechanism for failed payments
  async retryPayment(transactionId: string, maxRetries = 3, delayMs = 2000): Promise<PaymentResult> {
    const transaction = await db.transactions.get(transactionId);
    if (!transaction || !transaction.mpesaCheckoutRequestId) {
      return {
        success: false,
        message: 'Transaction not found or missing checkout request ID',
      };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.checkTransactionStatus(transaction.mpesaCheckoutRequestId);
        if (result.success) {
          return result;
        }

        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
        }
      } catch (error) {
        console.error(`Retry attempt ${attempt} failed:`, error);
        if (attempt === maxRetries) {
          return {
            success: false,
            message: 'All retry attempts failed',
          };
        }
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }

    return {
      success: false,
      message: 'Payment retry failed after all attempts',
    };
  }
}

// Create singleton instance
export const mpesaService = new MPesaService({
  consumerKey: import.meta.env.VITE_MPESA_CONSUMER_KEY || '',
  consumerSecret: import.meta.env.VITE_MPESA_CONSUMER_SECRET || '',
  passkey: import.meta.env.VITE_MPESA_PASSKEY || '',
  shortcode: import.meta.env.VITE_MPESA_SHORTCODE || '',
  callbackUrl: import.meta.env.VITE_MPESA_CALLBACK_URL || 'http://localhost:3000/api/mpesa/callback',
  environment: (import.meta.env.VITE_MPESA_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production',
});
