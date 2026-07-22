-- Execute este arquivo no phpMyAdmin (aba SQL ou Importar)
-- http://localhost/phpmyadmin

CREATE DATABASE IF NOT EXISTS nexaops CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'nexaops'@'localhost' IDENTIFIED BY 'nexaops';
GRANT ALL PRIVILEGES ON nexaops.* TO 'nexaops'@'localhost';
FLUSH PRIVILEGES;
