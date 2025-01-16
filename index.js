const express = require("express");
const app = express();
const SSLCommerzPayment = require("sslcommerz-lts");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const body_parser = require("body-parser");


require("dotenv").config();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const PORT = process.env.PORT || 5000;
const nodemailer = require("nodemailer");

//for course
const multer = require("multer");
const storage = multer.memoryStorage(); // Or configure as needed
const upload = multer({ storage });
// MiddleWare
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json());

app.use(body_parser.json());


// JWT Authentication Middleware
const verifyJWT = (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  const tokenWithoutBearer = token.split(" ")[1];

  jwt.verify(tokenWithoutBearer, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.user = decoded;
    next();
  });
};

// Admin Role Middleware
const verifyAdmin = async (req, res, next) => {
  try {
    const user = await client
      .db("PATH-FINDER")
      .collection("users")
      .findOne({ _id: new ObjectId(req.user.id) });
    if (user && user.role === "admin") {
      next();
    } else {
      res.status(403).send({ message: "Admin access required" });
    }
  } catch (error) {
    res.status(500).send({ message: "Error verifying admin role", error });
  }
};

// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.kwtddbl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.kwtddbl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

//ssl SSLCommerzPayment
const store_id = process.env.STORE_ID;
const store_passwd = process.env.STORE_PASS;
const is_live = false;

async function run() {
  try {
    const userCollections = client.db("PATH-FINDER").collection("users");
    const orderCollections = client.db("Bus-Ticket").collection("orders");
    const coursesCollections = client.db("PATH-FINDER").collection("courses");
    const allocatedSeatCollections = client
      .db("Bus-Ticket")
      .collection("allocatedSeat");


    // BKash Payment  
    app.use("/api/bkash/payment", require("./Routes/routes")(orderCollections));


    // Create user (sign-up)
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { phone: user.phone };
      const existingUser = await userCollections.findOne(query);

      if (existingUser) {
        return res
          .status(409)
          .send({ message: "User already exists. Please login." });
      }
      if (user.role === "subAdmin") {
        user.status = "pending";
      }

      const result = await userCollections.insertOne(user);
      res.status(200).send(result);
    });


    // Route to approve user status
    app.put("/users/:id/approve", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const role = req.body.role;
      const query = { _id: new ObjectId(id) };

      const update = role
        ? { $set: { subRole: role } }
        : { $set: { status: "approved" } };

      try {
        const result = await userCollections.updateOne(query, update);

        if (result.modifiedCount === 1) {
          res.status(200).send({
            success: true,
            message: role
              ? "Sub-role updated successfully"
              : "User approved successfully",
          });
        } else {
          res.status(404).send({
            success: false,
            message: "User not found or no changes made",
          });
        }
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Error updating user",
          error,
        });
      }
    });

    // Login
    app.post("/login", async (req, res) => {
      const { phone, password, role } = req.body;

      try {
        // Find the user by phone number
        const user = await userCollections.findOne({ phone });
        if (!user) {
          return res.status(402).send({ message: "User not found" });
        }

        if (user.role !== role) {
          return res
            .status(403)
            .send({ message: "Access denied. Role does not match." });
        }

        // Check if the password matches
        if (password !== user.password) {
          return res.status(401).send({ message: "Invalid password" });
        }

        const token = jwt.sign(
          { id: user._id, role: user.role },
          process.env.JWT_SECRET,
          { expiresIn: "15d" }
        );
        userToken = token;
        res.status(200).send({
          message: "Login successful",
          token,
          userId: user._id,
          role: user.role,
          subRole: user.subRole,
        });
      } catch (error) {
        res.status(500).send({ message: "Login failed", error });
      }
    });

    // add task to specific user
    app.post("/add-task", verifyJWT, async (req, res) => {
      const { userId, taskName, taskDescription, coin } = req.body;

      // Validate required fields
      if (!userId || !taskName || !taskDescription || !coin) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      try {
        // Find user by ID
        const user = await userCollections.findOne({
          _id: new ObjectId(userId),
        });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        // Construct the new task
        const newTask = {
          _id: new ObjectId(),
          taskName,
          taskDescription,
          coin,
          taskStatus: "pending", // Assign taskStatus here
        };

        // Add the task to the user's tasks array
        const result = await userCollections.updateOne(
          { _id: new ObjectId(userId) },
          { $push: { tasks: newTask } } // Use $push for arrays
        );

        if (result.modifiedCount === 1) {
          res
            .status(200)
            .json({ message: "Task added successfully", task: newTask });
        } else {
          res.status(500).json({ message: "Failed to add task" });
        }
      } catch (error) {
        console.error("Error adding task:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    //handle task, accept, decline, and increase coins and levelJ
    app.put("/handle-task/:id", verifyJWT, async (req, res) => {
      const taskId = req.params.id;
      const { userId, coin, action } = req.body;

      if (!["accept", "decline"].includes(action)) {
        return res.status(400).json({ message: "Invalid action" });
      }

      try {
        const query = {
          _id: new ObjectId(userId),
          "tasks._id": new ObjectId(taskId),
        };

        // Find the user to get the current coin count
        const user = await userCollections.findOne({
          _id: new ObjectId(userId),
        });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        const existingCoins = user.coins || 0;
        const newCoins =
          action === "accept"
            ? existingCoins + parseInt(coin, 10)
            : existingCoins;

        // Calculate the new level based on total coins
        const newLevel = Math.floor(newCoins / 100);

        // Build the update operation
        const update =
          action === "accept"
            ? {
              $inc: { coins: parseInt(coin, 10) },
              $set: {
                "tasks.$.taskStatus": "accepted",
                ...(newLevel > 0 && { level: newLevel }), // Only set level if it's greater than 0
              },
            }
            : {
              $set: { "tasks.$.taskStatus": "rejected" },
            };

        // Update the user
        const result = await userCollections.updateOne(query, update);

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Task or user not found" });
        }

        res.status(200).json({
          message: `Task successfully ${action}ed`,
          level: newLevel,
        });
      } catch (error) {
        console.error(`Error handling task (${action}):`, error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // Check user authentication status
    app.get("/auth-status", verifyJWT, async (req, res) => {
      res.status(200).send({ isLoggedIn: true, role: req.user.role });
    });

    // get user role for discount option
    app.get("/user-role/:userId", verifyJWT, async (req, res) => {
      try {
        const userId = req.params.userId;

        if (!userId) {
          return res.status(400).send({
            isLoggedIn: false,
            role: null,
            message: "User ID is required",
          });
        }

        const user = await userCollections.findOne({
          _id: new ObjectId(userId),
        });

        if (user) {
          const role = user.role;

          if (role === "subAdmin") {
            if (user.status === "approved") {
              return res
                .status(200)
                .send({ isLoggedIn: true, role: "subAdmin" });
            } else {
              return res.status(200).send({
                isLoggedIn: true,
                role: null,
                message: "Master status not approved",
              });
            }
          }

          if (role === "admin") {
            return res.status(200).send({ isLoggedIn: true, role: "admin" });
          }

          return res.status(200).send({ isLoggedIn: true, role: role });
        } else {
          return res
            .status(404)
            .send({ isLoggedIn: false, role: null, message: "User not found" });
        }
      } catch (error) {
        console.error("Error fetching user role:", error);
        return res.status(500).send({
          isLoggedIn: false,
          role: null,
          error: "Internal Server Error",
        });
      }
    });

    // get user and role and subRole for Dashboard access
    app.get("/get-user-role/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const user = await userCollections.findOne({ _id: new ObjectId(id) });
        if (user) {
          const { _id, name, phone, role, subRole, status, tasks, coins } =
            user;
          res
            .status(200)
            .send({ _id, name, phone, role, subRole, status, tasks, coins });
        } else {
          res.status(404).send({ message: "User not found" });
        }
      } catch (error) {
        res.status(500).send({ message: "Error fetching user", error });
      }
    });

    // Get all users
    app.get("/users", async (req, res) => {
      try {
        const user = userCollections.find();
        const result = await user.toArray();
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching users", error });
      }
    });

    // update users name, phone and code
    app.put("/specific-users/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { name, phone, code } = req.body;

      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { name, phone, code },
      };

      try {
        const result = await userCollections.updateOne(query, updateDoc);
        if (result.modifiedCount === 1) {
          res
            .status(200)
            .send({ success: true, message: "User updated successfully" });
        } else {
          res.status(404).send({ success: false, message: "User not found" });
        }
      } catch (error) {
        console.error("Error updating user:", error);
        res
          .status(500)
          .send({ success: false, message: "Error updating user", error });
      }
    });

    // Delete a specific user (admin-only access)
    app.delete("/users/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      try {
        const result = await userCollections.deleteOne(query);
        if (result.deletedCount === 1) {
          res.status(200).send({ message: "User deleted successfully" });
        } else {
          res.status(404).send({ message: "User not found" });
        }
      } catch (error) {
        res.status(500).send({ message: "Error deleting user", error });
      }
    });

    // email verification
    app.post("/forgetPassword", async (req, res) => {
      const { phone, email } = req.body;

      try {
        const existingUser = await userCollections.findOne({ phone });

        if (!existingUser) {
          return res.status(404).send({ message: "User not found" });
        }

        //sent email
        var transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: "190237@ku.ac.bd",
            pass: "afio mvyu nrrc urkv",
          },
        });
        const token = jwt.sign(
          { id: existingUser._id, role: existingUser.role },
          process.env.JWT_SECRET,
          { expiresIn: "5m" }
        );
        var mailOptions = {
          from: "190237@ku.ac.bd",
          to: email,
          subject: "Reset Password",
          text: `http://localhost:5173/resetPassword/${token}`,
        };

        transporter.sendMail(mailOptions, function (error, info) {
          if (error) {
            console.log(error);
          } else {
            console.log("Email sent: " + info.response);
          }
        });

        res.status(200).send({ message: "User found", email: email });
      } catch (error) {
        res
          .status(500)
          .send({ message: "Error while searching for user", error });
      }
    });

    // reset password
    app.post("/resetPassword", async (req, res) => {
      const { token, newPassword } = req.body;

      try {
        jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
          if (err) {
            return res
              .status(400)
              .send({ message: "Invalid or expired token" });
          }

          const user = await userCollections.findOne({
            _id: new ObjectId(decoded.id),
          });

          if (!user) {
            return res.status(404).send({ message: "User not found" });
          }

          const result = await userCollections.updateOne(
            { _id: new ObjectId(user._id) },
            { $set: { password: newPassword } }
          );

          if (result.modifiedCount === 1) {
            return res
              .status(200)
              .send({ message: "Password updated successfully" });
          } else {
            return res
              .status(500)
              .send({ message: "Failed to update password" });
          }
        });
      } catch (error) {
        res
          .status(500)
          .send({ message: "Error while resetting password", error });
      }
    });

    // Offline Payment
    app.post("/paymentoffline", async (req, res) => {
      const {
        price,
        name,
        email,
        location,
        address,
        phone,
        allocatedSeat,
        busName,
        counterMaster,
        selectedRoute,
        date,
      } = req.body;
      const tran_id = new ObjectId().toString();

      const order = {
        price,
        name,
        phone,
        email,
        location,
        address,
        allocatedSeat,
        tran_id,
        status: "offline",
        busName,
        counterMaster,
        selectedRoute,
        date,
      };

      try {
        const result = await busOrderCollection.insertOne(order);
        const blockedSeat = await allocatedSeatCollections.insertOne(order);

        if (result.insertedId) {
          res.json({
            redirectUrl: `http://localhost:5173/payment/success/${tran_id}`,
          });
        } else {
          res.status(500).json({ message: "Failed to create order" });
        }
      } catch (error) {
        console.error("Error inserting order:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Payment integration
    app.post("/payment", async (req, res) => {
      const price = req.body.price;
      const name = req.body.name;
      const email = req.body.email;
      const location = req.body.location;
      const address = req.body.address;
      const phone = req.body.phone;
      const allocatedSeat = req.body.allocatedSeat;
      const busName = req.body.busName;
      const counterMaster = req.body.counterMaster;
      const selectedRoute = req.body.selectedRoute;
      const date = req.body.date;

      const tran_id = new ObjectId().toString();
      const data = {
        total_amount: price,
        currency: "BDT",
        tran_id: tran_id,
        success_url: `http://localhost:5000/payment/success/${tran_id}`,
        fail_url: `http://localhost:5000/payment/fail/${tran_id}`,
        cancel_url: "http://localhost:3030/cancel",
        ipn_url: "http://localhost:3030/ipn",
        shipping_method: "Courier",
        product_name: "Computer.",
        product_category: "Electronic",
        product_profile: "general",
        cus_name: name,
        cus_email: email,
        cus_add1: address,
        cus_add2: "Dhaka",
        cus_city: "Dhaka",
        cus_state: "Dhaka",
        cus_postcode: "1000",
        cus_country: "Bangladesh",
        cus_phone: phone,
        cus_fax: "01711111111",
        ship_name: "Customer Name",
        ship_add1: "Dhaka",
        ship_add2: "Dhaka",
        ship_city: "Dhaka",
        ship_state: "Dhaka",
        ship_postcode: 1000,
        ship_country: "Bangladesh",
        location: location,
        allocatedSeat: allocatedSeat,
      };

      const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
      sslcz
        .init(data)
        .then((apiResponse) => {
          // console.log('API Response:', apiResponse); // Log full response for debugging
          if (apiResponse.GatewayPageURL) {
            // Redirect the user to payment gateway
            let GatewayPageURL = apiResponse.GatewayPageURL;
            res.send({ url: GatewayPageURL });

            const order = {
              price: price,
              name: name,
              phone: phone,
              email: email,
              location: location,
              address: address,
              allocatedSeat: allocatedSeat,
              tran_id: tran_id,
              status: "loading",
              busName: busName,
              counterMaster: counterMaster,
              selectedRoute: selectedRoute,
              date: date,
            };

            const result = busOrderCollection.insertOne(order);
            const blockedSeat = allocatedSeatCollections.insertOne(order);

            console.log("Redirecting to: ", GatewayPageURL);
          } else {
            res.status(400).send({
              error: "Failed to get GatewayPageURL",
              details: apiResponse,
            });
          }
        })
        .catch((error) => {
          console.error("SSLCommerz API Error:", error);
          res
            .status(500)
            .send({ error: "Payment initialization failed", details: error });
        });
    });

    // payment success
    app.post("/payment/success/:tran_id", async (req, res) => {
      const result = await busOrderCollection.updateOne(
        { tran_id: req.params.tran_id },
        {
          $set: { status: "paid" },
        }
      );
      const success = await allocatedSeatCollections.updateOne(
        { tran_id: req.params.tran_id },
        {
          $set: { status: "paid" },
        }
      );
      if (result.modifiedCount > 0) {
        res.redirect(
          `http://localhost:5173/payment/success/${req.params.tran_id}`
        );
      }
    });

    //payment fail
    app.post("/payment/fail/:tran_id", async (req, res) => {
      const result = await busOrderCollection.deleteOne({
        tran_id: req.params.tran_id,
      });

      const seat = await allocatedSeatCollections.deleteOne({
        tran_id: req.params.tran_id,
      });

      if (result.deletedCount > 0 && seat.deletedCount > 0) {
        res.redirect(
          `http://localhost:5173/payment/fail/${req.params.tran_id}`
        );
      } else {
        res
          .status(500)
          .send({ message: "Failed to delete order or seat data" });
      }
    });


    //  courses post

    // app.post("/courses", async (req, res) => {
    //   const { course_name, description, thumbnail_image, video, course_price } = req.body;
    //   try {
    //     const query = { course_name };
    //     const existingCourse = await coursesCollections.findOne(query);

    //     if (existingCourse) {
    //       return res
    //         .status(409)
    //         .send({ message: "Course already exists. Please use a different name." });
    //     }

    //     if (!user_id) {
    //       return res.status(400).send({ message: "User ID is required." });
    //     }

    //     const newCourse = {
    //       course_name,
    //       description,
    //       thumbnail_image,
    //       video,
    //       course_price,
    //       created_at: new Date(),
    //     };

    //     const result = await coursesCollections.insertOne(newCourse);
    //     res.status(200).send({ message: "Course added successfully", result });
    //   } catch (error) {
    //     console.error("Error adding course:", error);
    //     res.status(500).send({ message: "Failed to add course", error });
    //   }
    // });

    // Configure multer for file uploads



    app.post("/courses", upload.single("thumbnail_image"), async (req, res) => {
      try {
        const { course_name, description, video, course_price } = req.body;
        const file = req.file; // The uploaded file

        if (!file) {
          return res.status(400).send({ message: "Thumbnail image is required." });
        }

        const newCourse = {
          course_name,
          description,
          thumbnail_image: file.originalname, // Save file name or path
          video,
          course_price: parseFloat(course_price),
          created_at: new Date(),
        };

        const result = await coursesCollections.insertOne(newCourse);
        res.status(200).send({ message: "Course added successfully", result });
      } catch (error) {
        console.error("Error adding course:", error);
        res.status(500).send({ message: "Failed to add course", error });
      }
    });

    //courses get

    app.get("/courses", async (req, res) => {
      try {
        const user = coursesCollections.find();
        const result = await user.toArray();
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching users", error });
      }
    });

    // course update 

    app.put("/courses/update", async (req, res) => {
      const { id, course_name, description, video, course_price } = req.body;
      const thumbnail_image = req.file?.path; // Handle file if present

      try {
        const query = { _id: new ObjectId(id) };
        const updateData = {
          course_name,
          description,
          video,
          course_price,
          ...(thumbnail_image && { thumbnail_image }),
        };

        const result = await coursesCollections.updateOne(query, { $set: updateData });
        if (result.modifiedCount === 0) {
          return res.status(404).send({ message: "Course not found or no changes made." });
        }

        res.status(200).send({ message: "Course updated successfully", result });
      } catch (error) {
        console.error("Error updating course:", error);
        res.status(500).send({ message: "Failed to update course", error });
      }
    });


    // course delete 

    app.delete("/courses/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      try {
        const result = await coursesCollections.deleteOne(query);
        if (result.deletedCount === 1) {
          res.status(200).send({ message: "User deleted successfully" });
        } else {
          res.status(404).send({ message: "User not found" });
        }
      } catch (error) {
        res.status(500).send({ message: "Error deleting user", error });
      }
    });



    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Pathfinder is running");
});

app.listen(PORT, () => {
  console.log(`Pathfinder is running on ${PORT}`);
});
