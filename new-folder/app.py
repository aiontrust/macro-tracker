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

# === Weekly Summary Section ===
st.markdown("### 📅 Weekly Progress Summary")

# Allow user to choose a week to review
df['Week'] = df['Date'].dt.to_period('W').apply(lambda r: r.start_time)
available_weeks = sorted(df['Week'].unique(), reverse=True)
selected_week = st.selectbox("Select a week:", available_weeks, format_func=lambda x: x.strftime("%b %d, %Y"))

# Filter data to selected week
week_data = df[df['Week'] == selected_week].copy()
week_data.reset_index(drop=True, inplace=True)

# === Compute Weekly Stats ===
def in_target(val):
    return 125 <= val <= 250

summary = {
    'Macro': ['Protein', 'Carbs', 'Fat'],
    'Average': [week_data['Protein'].mean(), week_data['Carbs'].mean(), week_data['Fat'].mean()],
    'Min': [week_data['Protein'].min(), week_data['Carbs'].min(), week_data['Fat'].min()],
    'Max': [week_data['Protein'].max(), week_data['Carbs'].max(), week_data['Fat'].max()],
    'Days in Target': [
        week_data['Protein'].apply(in_target).sum(),
        week_data['Carbs'].apply(in_target).sum(),
        week_data['Fat'].apply(in_target).sum(),
    ]
}
summary_df = pd.DataFrame(summary)
summary_df = summary_df.round(1)

st.markdown("#### 📋 Weekly Macro Summary")
st.dataframe(summary_df, use_container_width=True)

# === Weekly Line Chart ===
st.markdown("#### 📈 Macro Trends This Week")

fig_week, ax_week = plt.subplots(figsize=(10, 4))
ax_week.plot(week_data['Date'], week_data['Protein'], color='violet', marker='o', label='Protein')
ax_week.plot(week_data['Date'], week_data['Carbs'], color='blue', marker='o', label='Carbs')
ax_week.plot(week_data['Date'], week_data['Fat'], color='red', marker='o', label='Fat')

ax_week.axhline(125, color='gray', linestyle='--', linewidth=1, label='125g Guide')
ax_week.axhline(250, color='gray', linestyle='--', linewidth=1, label='250g Guide')

ax_week.set_xlabel("Date")
ax_week.set_ylabel("Grams")
ax_week.set_title(f"Macro Trends: Week of {selected_week.strftime('%b %d, %Y')}")
ax_week.legend()
ax_week.grid(True)
fig_week.autofmt_xdate()

st.pyplot(fig_week)

# === Export Section ===
from io import BytesIO
import base64

st.markdown("#### 📤 Export This Summary")

# CSV export
csv = summary_df.to_csv(index=False).encode('utf-8')
st.download_button("Download CSV", csv, file_name=f"macro_summary_{selected_week.strftime('%Y_%m_%d')}.csv", mime='text/csv')

# PDF export (optional, requires `reportlab`)
try:
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet

    def generate_pdf(summary_df, week_label):
        buffer = BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter)
        styles = getSampleStyleSheet()
        elements = [Paragraph(f"Macro Summary: Week of {week_label}", styles['Title'])]

        data = [summary_df.columns.to_list()] + summary_df.values.tolist()
        table = Table(data)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.grey),
            ('GRID', (0,0), (-1,-1), 1, colors.black),
            ('ALIGN', (0,0), (-1,-1), 'CENTER')
        ]))

        elements.append(table)
        doc.build(elements)
        buffer.seek(0)
        return buffer

    pdf_buffer = generate_pdf(summary_df, selected_week.strftime('%b %d, %Y'))
    st.download_button("Download PDF", pdf_buffer, file_name=f"macro_summary_{selected_week.strftime('%Y_%m_%d')}.pdf", mime='application/pdf')

except ImportError:
    st.warning("Install `reportlab` to enable PDF export: `pip install reportlab`")
