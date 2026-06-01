import { sequelize } from "../db.js";
import { DataTypes } from "sequelize";

const JobClassification = sequelize.define(
  "JobClassification",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    job_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    // 'Design' | 'Product' | 'Other' — top-level grouping above role_family
    category: { type: DataTypes.STRING(20) },
    role_family: { type: DataTypes.STRING(100) },
    role_confidence: { type: DataTypes.FLOAT },
    seniority: { type: DataTypes.STRING(50) },
    portfolio_required: { type: DataTypes.BOOLEAN },
    employment_type: { type: DataTypes.STRING(50) },
    employment_confidence: { type: DataTypes.FLOAT },
    remote_type: { type: DataTypes.STRING(50) },
    job_post_language: { type: DataTypes.STRING(50) },
    required_languages: { type: DataTypes.JSON },
    optional_languages: { type: DataTypes.JSON },
    language_blocker: { type: DataTypes.BOOLEAN },
    // 'good' | 'maybe' | 'risk' | 'blocker' | 'unknown'
    language_match: { type: DataTypes.STRING(20) },
    // 'rule' | 'llm' | 'pending'
    classification_method: { type: DataTypes.STRING(20), defaultValue: "pending" },
    evidence: { type: DataTypes.JSON },
  },
  {
    tableName: "job_classifications",
    timestamps: false,
    underscored: true,
  }
);

export default JobClassification;
