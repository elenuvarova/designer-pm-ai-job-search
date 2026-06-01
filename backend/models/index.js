import { sequelize } from "../db.js";
import { DataTypes } from "sequelize";
import Source from "./Source.js";
import Job from "./Job.js";
import JobClassification from "./JobClassification.js";
import JobSkill from "./JobSkill.js";
import CvDocument from "./CvDocument.js";
import CvChunk from "./CvChunk.js";
import Application from "./Application.js";

Source.hasMany(Job, { foreignKey: "source_id", onDelete: "CASCADE" });
Job.belongsTo(Source, { foreignKey: "source_id" });

Job.hasOne(JobClassification, { foreignKey: "job_id", onDelete: "CASCADE" });
JobClassification.belongsTo(Job, { foreignKey: "job_id" });

Job.hasMany(JobSkill, { foreignKey: "job_id", onDelete: "CASCADE" });
JobSkill.belongsTo(Job, { foreignKey: "job_id" });

Job.hasOne(Application, { foreignKey: "job_id", onDelete: "CASCADE" });
Application.belongsTo(Job, { foreignKey: "job_id" });

CvDocument.hasMany(CvChunk, { foreignKey: "cv_document_id", onDelete: "CASCADE" });
CvChunk.belongsTo(CvDocument, { foreignKey: "cv_document_id" });

// A column added to a model after its table already exists is NOT created by a
// plain sync() (sync never ALTERs existing tables). This idempotently adds any
// such column on boot — safe to run every time, dialect-agnostic.
async function ensureColumns() {
  const qi = sequelize.getQueryInterface();
  const wanted = [
    { table: "jobs", column: "embedding", spec: { type: DataTypes.JSON, allowNull: true } },
    { table: "jobs", column: "salary_min", spec: { type: DataTypes.FLOAT, allowNull: true } },
    { table: "jobs", column: "salary_max", spec: { type: DataTypes.FLOAT, allowNull: true } },
    { table: "jobs", column: "salary_currency", spec: { type: DataTypes.STRING(3), allowNull: true } },
    { table: "job_classifications", column: "category", spec: { type: DataTypes.STRING(20), allowNull: true } },
    { table: "job_classifications", column: "portfolio_required", spec: { type: DataTypes.BOOLEAN, allowNull: true } },
  ];
  for (const { table, column, spec } of wanted) {
    try {
      const desc = await qi.describeTable(table);
      if (!desc[column]) {
        await qi.addColumn(table, column, spec);
        console.log(`[db] added missing column ${table}.${column}`);
      }
    } catch (err) {
      console.error(`[db] ensureColumns ${table}.${column}: ${err.message}`);
    }
  }
}

export async function syncModels() {
  await sequelize.sync();
  await ensureColumns();
}

export { Source, Job, JobClassification, JobSkill, CvDocument, CvChunk, Application };
