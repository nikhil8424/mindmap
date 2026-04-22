import { Router, type IRouter } from "express";
import healthRouter from "./health";
import graphRouter from "./graph";

const router: IRouter = Router();

router.use(healthRouter);
router.use(graphRouter);

export default router;
