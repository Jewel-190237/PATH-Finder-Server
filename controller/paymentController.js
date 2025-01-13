const { getValue, setValue } = require("node-global-storage");
const axios = require("axios");
const paymentModel = require('../model/paymentModel')

class paymentController {
  bkash_headers = async () => {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      authorization: getValue("id_token"),
      "x-app-key": process.env.bkash_api_key,
    };
  };

  payment_create = async (req, res) => {
    const { amount } = req.body;
    try {
      const { data } = await axios.post(
        process.env.bkash_create_payment_url,
        {
          mode: "0011",
          payerReference: " ",
          callbackURL: "http://localhost:5000/api/bkash/payment/callback",
          amount: amount,
          currency: "BDT",
          intent: "sale",
          merchantInvoiceNumber: "InvoiceNumber",
        },
        {
          headers: await this.bkash_headers(),
        }
      );
      console.log(data);
      return res.status(200).json({ bkashURL: data.bkashURL });
      //   return res.status(200).json({ bkashURL: data.bkashURL });
    } catch (error) {
      return res.status(401).json({ error: error.message });
    }
  };

  call_back = async (req, res) => {
    const { paymentID, status } = req.query;

    if (status === "cancel" || status === "failure") {
      return res.redirect(`http://localhost:5173/payment/fail?message=${status}`);
    }
    if (status === "success") {
      try {
        const { data } = await axios.post(
          process.env.bkash_execute_payment_url,
          { paymentID },
          {
            headers: await this.bkash_headers(),
          }
        );
        if (data && data.statusCode === "0000") {
          await paymentModel.create({
            userId: Math.random() * 10 + 1,
            paymentID,
            trxID: data.trxID,
            date: data.paymentExecuteTime,
            amount: parseInt(data.amount),
          });

          return res.redirect(`http://localhost:5173/payment/success`);
        } else {
          return res.redirect(
            `http://localhost:5173/payment/fail?message=${data.statusMessage}`
          );
        }
      } catch (error) {
        console.log(error);
        return res.redirect(
          `http://localhost:5173/payment/fail?message=${error.message}`
        );
      }
    }
  };
}

module.exports = new paymentController();
