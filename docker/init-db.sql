-- Runs once when the database volume is first created.
CREATE ROLE liquidledger LOGIN PASSWORD 'liquidledger' CREATEDB;
CREATE DATABASE liquidledger OWNER liquidledger;
CREATE DATABASE liquidledger_test OWNER liquidledger;
