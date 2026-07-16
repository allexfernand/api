-- Sinistralidade v2: objetos de controle. Executar primeiro em homologação.

CREATE TABLE IF NOT EXISTS hive_metastore.sanus_prod.sinistralidade_ingestion_manifest_v2 (
  manifest_id STRING NOT NULL,
  operator_key STRING NOT NULL,
  company_key STRING NOT NULL,
  source_file_name STRING NOT NULL,
  source_file_sha256 STRING,
  reference_month STRING NOT NULL,
  expected_rows BIGINT,
  received_rows BIGINT,
  expected_gross_cost DECIMAL(20,2),
  received_gross_cost DECIMAL(20,2),
  status STRING NOT NULL,
  received_at TIMESTAMP,
  reconciled_at TIMESTAMP,
  approved_by STRING,
  notes STRING,
  created_at TIMESTAMP NOT NULL
) USING DELTA
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true');

CREATE TABLE IF NOT EXISTS hive_metastore.sanus_prod.sinistralidade_month_status_v2 (
  company_key STRING NOT NULL,
  month_key STRING NOT NULL,
  status STRING NOT NULL,
  expected_files INT,
  received_files INT,
  silver_rows BIGINT,
  gold_rows BIGINT,
  silver_gross_cost DECIMAL(20,2),
  gold_gross_cost DECIMAL(20,2),
  eligibility_status STRING,
  quality_status STRING,
  closed_at TIMESTAMP,
  approved_by STRING,
  contract_version STRING NOT NULL,
  updated_at TIMESTAMP NOT NULL
) USING DELTA
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true');

CREATE TABLE IF NOT EXISTS hive_metastore.sanus_prod.beneficiary_eligibility_snapshot_v2 (
  snapshot_date DATE NOT NULL,
  company_key STRING NOT NULL,
  person_key STRING NOT NULL,
  family_key STRING,
  source_company_id STRING,
  source_beneficiary_id STRING,
  beneficiary_type STRING,
  relationship STRING,
  active BOOLEAN NOT NULL,
  coverage_start_date DATE,
  coverage_end_date DATE,
  birth_date DATE,
  sex STRING,
  city STRING,
  state STRING,
  source_table STRING NOT NULL,
  source_ingested_at TIMESTAMP,
  contract_version STRING NOT NULL,
  created_at TIMESTAMP NOT NULL
) USING DELTA
PARTITIONED BY (snapshot_date)
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true');

CREATE TABLE IF NOT EXISTS hive_metastore.sanus_prod.sinistralidade_quality_run_v2 (
  quality_run_id STRING NOT NULL,
  object_name STRING NOT NULL,
  company_key STRING,
  month_key STRING,
  check_name STRING NOT NULL,
  status STRING NOT NULL,
  observed_value DOUBLE,
  expected_value DOUBLE,
  tolerance DOUBLE,
  details STRING,
  checked_at TIMESTAMP NOT NULL,
  contract_version STRING NOT NULL
) USING DELTA;

CREATE TABLE IF NOT EXISTS hive_metastore.sanus_prod.sinistralidade_company_alias_v2 (
  source_system STRING NOT NULL,
  source_company_id STRING,
  source_company_name_normalized STRING NOT NULL,
  operator_key STRING,
  company_key STRING NOT NULL,
  canonical_company_name STRING NOT NULL,
  status STRING NOT NULL,
  approved_by STRING,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
) USING DELTA
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true');
