const axios = require("axios");
const { getValue, setValue } = require("node-global-storage");
class middleware {
  bkash_auth = async (req, res, next) => {
    try {
      const { data } = await axios.post(
        process.env.bkash_grant_token_url,
        {
          app_key: process.env.bkash_api_key,
          app_secret: process.env.bkash_secret_key,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            username: process.env.bkash_username,
            password: process.env.bkash_password,
          },
        }
      );
      console.log(data);
      setValue("id_token", data.id_token, { protected: true });
      next();
    } catch (error) {
      return res.status(401).json({ error: error.message })
    }
  };
}

module.exports = new middleware();
