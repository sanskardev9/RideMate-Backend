import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errors.js";
import { findRider, login, register, updateProfile } from "../services/auth.service.js";

export const authRoutes = Router();

authRoutes.post(
  "/register",
  asyncHandler(async (req, res) => res.status(201).json(await register(req.body))),
);

authRoutes.post(
  "/login",
  asyncHandler(async (req, res) => res.json(await login(req.body))),
);

authRoutes.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => res.json(await findRider(req.rider.id))),
);

// The name is baked into the token (it labels chat and map pins), so a fresh
// token comes back with the updated rider.
authRoutes.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => res.json(await updateProfile(req.rider.id, req.body))),
);
