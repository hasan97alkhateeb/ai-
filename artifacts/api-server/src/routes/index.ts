import { Router, type IRouter } from "express";
import dashboardRouter from "./dashboard";
import healthRouter from "./health";
import learningRouter from "./learning";
import practiceRouter from "./practice";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(learningRouter);
router.use(practiceRouter);

export default router;
