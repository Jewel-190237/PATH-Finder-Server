const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");
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

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure Multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "courses",
    allowed_formats: ["jpg", "jpeg", "png"],
  },
});
const upload = multer({ storage });
// MiddleWare
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

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
    const coursesCollections = client.db("PATH-FINDER").collection("courses");
    const orderCollections = client.db("PATH-FINDER").collection("orders");
    const projectCollections = client.db("PATH-FINDER").collection("projects");
    const allocatedSeatCollections = client
      .db("Bus-Ticket")
      .collection("allocatedSeat");

    // BKash Payment
    app.use("/api/bkash/payment", require("./Routes/routes")(orderCollections));

    // Route to fetch all courses for a specific user
    app.get("/courses/student/:userId", async (req, res) => {
      const { userId } = req.params;

      try {
        // Find orders for the given userId
        const orders = await orderCollections.find({ userId }).toArray();

        if (!orders.length) {
          return res
            .status(404)
            .json({ message: "No orders found for this user" });
        }

        // Extract courseIds from orders
        const courseIds = orders.map((order) => new ObjectId(order.courseId));

        // Fetch full course details
        const courses = await coursesCollections
          .find({ _id: { $in: courseIds } })
          .toArray();

        res.json(courses);
      } catch (error) {
        console.error("Error fetching courses:", error);
        res.status(500).json({ message: "Failed to fetch courses" });
      }
    });

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

    //handle task for student / user
    app.put("/handle-task-user/:id", verifyJWT, async (req, res) => {
      const taskId = req.params.id;
      const { userId } = req.body;

      try {
        const query = {
          _id: new ObjectId(userId),
          "tasks._id": new ObjectId(taskId),
        };

        const user = await userCollections.findOne({
          _id: new ObjectId(userId),
        });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        const update = {
          $set: {
            "tasks.$.taskStatus": "submitted",
          },
        };
        const result = await userCollections.updateOne(query, update);

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Task or user not found" });
        }

        res.status(200).json({
          message: `Task successfully submitted`,
        });
      } catch (error) {
        console.error(`Error handling task submitted:`, error);
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
          const {
            _id,
            name,
            phone,
            role,
            subRole,
            status,
            tasks,
            coins,
            code,
            level,
            whatsappLink,
            telegramLink,
            facebookLink,
            fatherContactNumber,
            motherContactNumber,
            address,
            subDistrict,
            district,
            zipCode,
            country,
            imageUrl,
          } = user;
          res.status(200).send({
            _id,
            name,
            phone,
            role,
            subRole,
            status,
            tasks,
            coins,
            code,
            level,
            whatsappLink,
            telegramLink,
            facebookLink,
            fatherContactNumber,
            motherContactNumber,
            address,
            subDistrict,
            district,
            zipCode,
            country,
            imageUrl,
          });
        } else {
          res.status(404).send({ message: "User not found" });
        }
      } catch (error) {
        res.status(500).send({ message: "Error fetching user", error });
      }
    });

    app.put("/users/:id", async (req, res) => {
      const _id = req.params.id; // Extract ID from the route parameter
      const updatedUser = req.body; // Extract updated user data from the request body
      console.log("User ID:", _id, "Updated Data:", updatedUser);
      try {
        // Validate the ID format
        if (!ObjectId.isValid(_id)) {
          return res.status(400).send({ message: "Invalid user ID format." });
        }

        // Ensure `_id` in the payload is removed to avoid conflicts
        if (updatedUser._id) {
          delete updatedUser._id;
        }

        // Add the correct `_id` back into the payload
        updatedUser._id = new ObjectId(_id);

        // Validate the updated user data
        if (
          !updatedUser ||
          typeof updatedUser !== "object" ||
          Object.keys(updatedUser).length === 0
        ) {
          return res
            .status(400)
            .send({ message: "Invalid user data provided." });
        }

        // Replace the entire document with the updated user object
        const query = { _id: new ObjectId(_id) };
        const result = await userCollections.replaceOne(query, updatedUser);

        if (result.modifiedCount > 0) {
          return res
            .status(200)
            .send({ message: "User updated successfully." });
        } else {
          return res
            .status(304)
            .send({ message: "No changes made to the user." });
        }
      } catch (error) {
        console.error("Error updating user:", error.message);
        return res
          .status(500)
          .send({ message: `Failed to update user: ${error.message}` });
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

    // Configure multer for file uploads
    app.post("/courses", upload.single("thumbnail_image"), async (req, res) => {
      try {
        const { course_name, description, video, course_price } = req.body;
        const file = req.file; // Uploaded file

        if (!file) {
          return res
            .status(400)
            .send({ message: "Thumbnail image is required." });
        }

        const newCourse = {
          course_name,
          description,
          thumbnail_image: file.path, // Cloudinary URL
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

    //get course
    app.get("/courses", async (req, res) => {
      try {
        const user = coursesCollections.find();
        const result = await user.toArray();
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching users", error });
      }
    });

    // Get a specific course
    app.get("/courses/:id", async (req, res) => {
      const { id } = req.params; // Get the course ID from the URL

      try {
        const course = await coursesCollections.findOne({
          _id: new ObjectId(id),
        }); // Find course by ID
        if (!course) {
          return res.status(404).send({ message: "Course not found" });
        }
        res.status(200).send(course);
      } catch (error) {
        console.error("Error fetching course:", error);
        res.status(500).send({ message: "Error fetching course", error });
      }
    });

    app.put("/courses/:id", async (req, res) => {
      const { course_name, description, video, course_price } = req.body;
      const _id = req.params.id;
      const thumbnail_image = req.file?.path; // This should point to the uploaded image file

      try {
        const query = { _id: new ObjectId(_id) };
        const updateData = {
          course_name,
          description,
          video,
          course_price,
          ...(thumbnail_image && { thumbnail_image }), // Only add this if an image is uploaded
        };

        const result = await coursesCollections.updateOne(query, {
          $set: updateData,
        });
        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .send({ message: "Course not found or no changes made." });
        }

        res
          .status(200)
          .send({ message: "Course updated successfully", result });
      } catch (error) {
        console.error("Error updating course:", error);
        res.status(500).send({ message: "Failed to update course", error });
      }
    });

    app.delete("/courses/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      try {
        const result = await coursesCollections.deleteOne(query);
        if (result.deletedCount === 1) {
          res.status(200).send({ message: "Course deleted successfully" }); // Corrected message
        } else {
          res.status(404).send({ message: "Course not found" }); // Consistent naming
        }
      } catch (error) {
        res.status(500).send({ message: "Error deleting course", error }); // Consistent naming
      }
    });

    // create project
    app.post("/add-new-project", async (req, res) => {
      const { userId, ProjectName, problem, idea, solve } = req.body;

      if (!userId || !ProjectName || !problem || !idea || !solve) {
        return res
          .status(400)
          .json({ success: false, message: "All fields are required" });
      }
      const newProject = {
        userId,
        ProjectName,
        problem,
        idea,
        solve,
        createdAt: new Date(),
      };

      try {
        const result = await projectCollections.insertOne(newProject);
        res.status(201).json({
          success: true,
          message: "Project added successfully",
          projectId: result.insertedId,
        });
      } catch (error) {
        console.error("Error adding project:", error);
        res
          .status(500)
          .json({ success: false, message: "Failed to add project" });
      }
    });

    // get a specific user project
    app.get("/projects/:userId", verifyJWT, async (req, res) => {
      const { userId } = req.params;

      if (!userId) {
        return res
          .status(400)
          .json({ success: false, message: "User ID is required" });
      }

      try {
        const projects = await projectCollections.find({ userId }).toArray();

        if (!projects.length) {
          return res
            .status(404)
            .json({
              success: false,
              message: "No projects found for this user",
            });
        }

        res.status(200).json({ success: true, projects });
      } catch (error) {
        console.error("Error fetching projects by user ID:", error);
        res
          .status(500)
          .json({ success: false, message: "Failed to fetch projects" });
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
