import streamlit as st
import pandas as pd
import matplotlib.pyplot as plt
from datetime import datetime
import os

# === File Setup ===
CSV_FILE = "macro_log.csv"

# === Load or create CSV ===
if os.path.exists(CSV_FILE):
df = pd.read_csv(CSV_FILE, parse_dates=['Date'])
else:
df = pd.DataFrame(columns=['Date', 'Protein', 'Carbs', 'Fat'])
df.to_csv(CSV_FILE, index=False)

# === Today’s date ===
today = pd.to_datetime(datetime.today().date())

# === Load or initialize today's entry ===
if today not in df['Date'].values:
new_row = pd.DataFrame([{
'Date': today,
'Protein': 0,
'Carbs': 0,
'Fat': 0
}])
df = pd.concat([df, new_row], ignore_index=True)
df.to_csv(CSV_FILE, index=False)

# === Sidebar Inputs ===
st.title("💪 Daily Macro Tracker (Mentzer Style)")

st.markdown("Enter your macros for **today**:")

latest_index = df[df['Date'] == today].index[0]

protein = st.number_input("Protein (g)", min_value=0, max_value=300,
value=int(df.at[latest_index, 'Protein']), step=1)
carbs = st.number_input("Carbs (g)", min_value=0, max_value=400,
value=int(df.at[latest_index, 'Carbs']), step=1)
fat = st.number_input("Fat (g)", min_value=0, max_value=200,
value=int(df.at[latest_index, 'Fat']), step=1)

# === Save values ===
df.at[latest_index, 'Protein'] = protein
df.at[latest_index, 'Carbs'] = carbs
df.at[latest_index, 'Fat'] = fat
df.to_csv(CSV_FILE, index=False)

# === Plotting ===
st.markdown("### 📈 Macro Trend Over Time")

fig, ax = plt.subplots(figsize=(10, 5))

ax.plot(df['Date'], df['Protein'], color='violet', marker='o', label='Protein')
ax.plot(df['Date'], df['Carbs'], color='blue', marker='o', label='Carbs')
ax.plot(df['Date'], df['Fat'], color='red', marker='o', label='Fat')

ax.axhline(125, color='gray', linestyle='--', linewidth=1, label='125g Guide')
ax.axhline(250, color='gray', linestyle='--', linewidth=1, label='250g Guide')

ax.set_xlabel("Date")
ax.set_ylabel("Grams")
ax.set_title("Macronutrient Intake (g) Over Time")
ax.legend()
ax.grid(True)
fig.autofmt_xdate()

st.pyplot(fig) 
