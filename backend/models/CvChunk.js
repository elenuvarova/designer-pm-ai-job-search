import { sequelize } from "../db.js";
import { DataTypes } from "sequelize";

const CvChunk = sequelize.define(
  "CvChunk",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    cv_document_id: { type: DataTypes.INTEGER, allowNull: false },
    chunk_text: { type: DataTypes.TEXT },
    embedding: { type: DataTypes.JSON }, // float[] — 768-dim from Gemini gemini-embedding-001
    embedding_model: { type: DataTypes.STRING }, // which model produced `embedding` (space provenance)
  },
  {
    tableName: "cv_chunks",
    timestamps: false,
    underscored: true,
    indexes: [{ fields: ["cv_document_id"] }],
  }
);

export default CvChunk;
